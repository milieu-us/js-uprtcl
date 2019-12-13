import { flatMap } from 'lodash';
import { ApolloClient, gql } from 'apollo-boost';
import { LitElement, property, html, query, css, PropertyValues } from 'lit-element';

import { Menu } from '@authentic/mwc-menu';
import '@authentic/mwc-list';
import '@material/mwc-icon-button';

import { moduleConnect } from '@uprtcl/micro-orchestrator';
import { PatternRecognizer } from '@uprtcl/cortex';
import { GraphQlTypes } from '@uprtcl/common';

import { Lens } from '../types';

export class CortexLensSelector extends moduleConnect(LitElement) {
  @property({ type: String })
  public hash!: string;

  @property({ type: Array })
  private lenses!: Lens[] | undefined;

  @query('#menu')
  menu!: Menu;

  patternRecognizer!: PatternRecognizer;

  static get styles() {
    return css`
      .hidden {
        visibility: hidden;
      }
    `;
  }

  async loadLenses() {
    this.lenses = undefined;
    if (!this.hash) return;

    const client: ApolloClient<any> = this.request(GraphQlTypes.Client);

    const result = await client.query({
      query: gql`
      {
        getEntity(id: "${this.hash}", depth: 1) {
          id
          raw
          isomorphisms {
            patterns {
              lenses {
                name
                render
              }
            }
          }
        }
      }
      `
    });

    const isomorphisms = result.data.getEntity.isomorphisms;

    const lenses = flatMap(isomorphisms.reverse(), iso => iso.patterns.lenses);
    this.lenses = lenses.filter(iso => !!iso);
  }

  firstUpdated() {
    this.loadLenses();
  }

  updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);

    if (changedProperties.get('hash')) {
      this.loadLenses();
    }
  }

  show() {
    return this.lenses && this.lenses.length > 1;
  }

  render() {
    return html`
      <mwc-icon-button
        icon="remove_red_eye"
        class=${this.show() ? '' : 'hidden'}
        @click=${() => (this.menu.open = !this.menu.open)}
      ></mwc-icon-button>

      <mwc-menu id="menu" class=${this.show() ? '' : 'hidden'}>
        <mwc-list>
          ${this.lenses &&
            this.lenses.map(
              lens =>
                html`
                  <mwc-list-item @click=${() => this.selectLens(lens)}>
                    ${lens.name}
                  </mwc-list-item>
                `
            )}
        </mwc-list>
      </mwc-menu>
    `;
  }

  selectLens(lens: Lens) {
    this.menu.open = false;
    this.dispatchEvent(
      new CustomEvent('lens-selected', {
        detail: { selectedLens: lens },
        bubbles: true,
        composed: true
      })
    );
  }
}