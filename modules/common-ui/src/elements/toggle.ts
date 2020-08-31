import { LitElement, html, css, property } from 'lit-element';
import { styles } from './styles.css';
import { icons } from './icons';

export class UprtclToggle extends LitElement {
  @property({ type: String })
  icon!: string;

  @property({ type: Boolean })
  disabled: boolean = false;

  @property({ type: Boolean })
  active: boolean = false;

  render() {
    return html`
    <div class="toggle-container">
      ${this.icon !== undefined
        ? html`<div class="icon-container">${icons[this.icon]}</div>`
        : ''}
      <slot></slot>
      <div 
        class="toggle toggled-${this.active ? 'on' : 'off'} ${this.disabled ? 'disabled' : ''}"
      ></div>
    </div>
    `;
  }

  static get styles() {
    return [
      styles,
      css`
        .toggle-container {
          display: flex;
        }
        .toggle {
          display: flex;
          position: relative;
          height: 40px;
          width: 100px;
          background-color: lightgray;
          cursor: pointer;
        }
        .toggle:after {
          content: '';
          position: absolute;
          top: 5px;
          height: 30px;
          width: 45px;
        }
        .toggled-off:after {
          left: 5px;
          background-color: gray;
        }
        .toggled-on:after {
          right: 5px;
          background-color: #2196f3; 
        }
        .icon-container {
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: center;
          margin-right: 10px;
        }
      `,
    ];
  }
}