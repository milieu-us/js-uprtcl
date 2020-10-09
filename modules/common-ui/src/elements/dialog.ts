import { LitElement, html, property, css } from 'lit-element';

export class UprtclDialog extends LitElement {
  @property({ type: Boolean, attribute: 'actions' })
  actions: boolean = true;

  @property({ type: String, attribute: 'primary-text' })
  primaryText: string = 'Ok';

  @property({ type: String, attribute: 'secondary-text' })
  secondaryText: string = 'Cancel';

  @property({ type: String, attribute: 'secondary-icon' })
  secondaryIcon: string = 'clear';

  @property({ type: String, attribute: 'show-secondary' })
  showSecondary: string = 'false';

  @property({ attribute: false })
  resolved: Function | undefined = undefined;

  secondaryClicked(e) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('secondary'));
    if (this.resolved) this.resolved(false);
  }

  primaryClicked(e) {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent('primary'));
    if (this.resolved) this.resolved(true);
  }

  render() {
    return html`
      <div class="modal">
        <div class="modal-content">
          <div class="slot-container">
            <slot></slot>
          </div>
          ${this.actions ? html`
          <div class="buttons-container">
            ${this.showSecondary === 'true'
              ? html`
                <uprtcl-button
                  @click=${this.secondaryClicked}
                  icon=${this.secondaryIcon}
                  skinny
                >
                  ${this.secondaryText}
                </uprtcl-button>
              `
              : ''}
              <uprtcl-button @click=${this.primaryClicked}>
                ${this.primaryText}
              </uprtcl-button>
          ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  static get styles() {
    return css`
      .modal {
        position: fixed;
        z-index: 100;
        height: 100%;
        width: 100%;
        background-color: #b8b8b86d;
        left: 0;
        top: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .modal-content {
        width: 90vw;
        max-width: 900px;
        margin: 0 auto;
        padding: 3vw 3vw;
        background-color: white;
        border-radius: 4px;
        box-shadow: 10px 10px 67px 0px rgba(0, 0, 0, 0.75);
      }

      .slot-container {
        margin-bottom: 3vw;
        max-height: calc(100vh - 200px);
        min-height: 50vh;
        overflow-y: auto;
      }

      .buttons-container {
        display: flex;
        justify-content: flex-end;
        width: 100%;
        flex-direction: row;
      }
      .buttons-container uprtcl-button {
        width: 150px;
        margin-left: 12px;
      }
    `;
  }
}
