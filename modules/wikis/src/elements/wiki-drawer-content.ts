import { property, html, css, LitElement, query } from 'lit-element';
import { ApolloClient, gql } from 'apollo-boost';
const styleMap = style => {
  return Object.entries(style).reduce((styleString, [propName, propValue]) => {
    propName = propName.replace(/([A-Z])/g, matches => `-${matches[0].toLowerCase()}`);
    return `${styleString}${propName}:${propValue};`;
  }, '');
};

import { htmlToText, TextType, TextNode } from '@uprtcl/documents';
import { Logger, moduleConnect } from '@uprtcl/micro-orchestrator';
import { sharedStyles } from '@uprtcl/lenses';
import { Entity, HasTitle, CortexModule, PatternRecognizer, Signed } from '@uprtcl/cortex';
import {
  EveesRemote,
  EveesModule,
  EveesHelpers,
  Perspective,
  CONTENT_UPDATED_TAG,
  ContentUpdatedEvent
} from '@uprtcl/evees';
import { MenuConfig } from '@uprtcl/common-ui';
import { ApolloClientModule } from '@uprtcl/graphql';
import { CASStore, loadEntity } from '@uprtcl/multiplatform';

import { Wiki } from '../types';

import { WikiBindings } from '../bindings';

const MAX_LENGTH = 999;

interface PageData {
  id: string;
  title: string;
}

export class WikiDrawerContent extends moduleConnect(LitElement) {
  logger = new Logger('WIKI-DRAWER-CONTENT');

  @property({ type: String })
  uref!: string;

  @property({ type: String })
  color!: string;

  @property({ type: Boolean })
  editable: boolean = false;

  @property({ attribute: false })
  loading: boolean = true;

  @property({ attribute: false })
  wiki: Entity<Wiki> | undefined;

  @property({ attribute: false })
  pagesList: PageData[] | undefined = undefined;

  @property({ attribute: false })
  selectedPageIx: number | undefined = undefined;

  @property({ attribute: false })
  creatingNewPage: boolean = false;

  @property({ attribute: false })
  isDrawerOpened = true;

  @property({ attribute: false })
  isMobile = false;

  @property({ attribute: false })
  hasSelectedPage = false;

  @property({ attribute: false })
  editableActual: boolean = false;

  remote: string = '';
  currentHeadId: string | undefined = undefined;

  protected client!: ApolloClient<any>;
  protected eveesRemotes!: EveesRemote[];
  protected recognizer!: PatternRecognizer;

  constructor() {
    super();
    this.isViewportMobile();
    window.addEventListener('resize', () => this.isViewportMobile());
  }

  async firstUpdated() {
    this.client = this.request(ApolloClientModule.bindings.Client);
    this.eveesRemotes = this.requestAll(EveesModule.bindings.EveesRemote);
    this.recognizer = this.request(CortexModule.bindings.Recognizer);

    this.logger.log('firstUpdated()', { uref: this.uref });

    this.load();
  }

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(CONTENT_UPDATED_TAG, ((e: ContentUpdatedEvent) => {
      if (e.detail.uref === this.uref) {
        this.logger.log('ContentUpdatedEvent()', this.uref);
        this.load();
      }
    }) as EventListener);
  }

  private isViewportMobile() {
    if (window.innerWidth <= 768) {
      if (!this.isMobile) {
        this.isMobile = true;
      }
    } else {
      if (this.isMobile) {
        this.isMobile = false;
      }
    }
  }

  updated(changedProperties) {
    if (changedProperties.get('uref') !== undefined) {
      this.logger.info('updated()', { changedProperties });
      this.reset();
    }
  }

  async reset() {
    // await this.client.resetStore();
    this.pagesList = undefined;
    this.selectedPageIx = undefined;
    this.wiki = undefined;
    this.logger.log('reset()', this.uref);
    this.load();
  }

  async load() {
    if (this.uref === undefined) return;

    this.logger.log('load()');
    this.loading = true;

    const perspective = (await loadEntity(this.client, this.uref)) as Entity<Signed<Perspective>>;
    const headId = await EveesHelpers.getPerspectiveHeadId(this.client, this.uref);

    this.remote = perspective.object.payload.remote;
    const canWrite = await EveesHelpers.canWrite(this.client, this.uref);

    this.currentHeadId = headId;
    this.editableActual = this.editable && canWrite;

    this.wiki = await EveesHelpers.getPerspectiveData(this.client, this.uref);

    await this.loadPagesData();

    this.loading = false;
  }

  async loadPagesData() {
    if (!this.wiki) {
      this.pagesList = [];
      return;
    }

    this.logger.log('loadPagesData()');

    const pagesListPromises = this.wiki.object.pages.map(
      async (pageId): Promise<PageData> => {
        const data = await EveesHelpers.getPerspectiveData(this.client, pageId);
        const hasTitle: HasTitle = this.recognizer
          .recognizeBehaviours(data)
          .find(b => (b as HasTitle).title);

        const title = hasTitle.title(data);

        return {
          id: pageId,
          title
        };
      }
    );

    this.pagesList = await Promise.all(pagesListPromises);
    this.logger.log('loadPagesData()', { pagesList: this.pagesList });
  }

  selectPage(ix: number | undefined) {
    if (!this.wiki) return;

    this.selectedPageIx = ix;

    if (this.selectedPageIx === undefined) {
      this.hasSelectedPage = false;
      return;
    }

    this.dispatchEvent(
      new CustomEvent('page-selected', {
        detail: {
          pageId: this.wiki.object.pages[this.selectedPageIx]
        }
      })
    );
    this.hasSelectedPage = true;
    if (this.isMobile) {
      this.isDrawerOpened = false;
    }
  }

  getStore(remote: string, type: string): CASStore | undefined {
    const remoteInstance = this.eveesRemotes.find(r => r.id === remote);
    if (!remoteInstance) throw new Error(`Remote not found for remote ${remote}`);
    return remoteInstance.store;
  }

  handlePageDrag(e, pageId) {
    const dragged = { uref: pageId, parentId: this.uref };
    this.logger.info('dragging', dragged);
    e.dataTransfer.setData('text/plain', JSON.stringify(dragged));
  }

  async handlePageDrop(e) {
    const wikiObject = this.wiki
      ? this.wiki.object
      : {
          title: '',
          pages: []
        };

    const dragged = JSON.parse(e.dataTransfer.getData('text/plain'));

    this.logger.info('dropped', dragged);

    if (!this.wiki) return;
    if (!dragged.uref) return;
    if (dragged.parentId === this.uref) return;

    const index = this.wiki.object.pages.length;

    const result = await this.splicePages(wikiObject, [dragged.uref], index, 0);

    if (!result.entity) throw Error('problem with splice pages');

    await this.updateContent(result.entity);
  }

  dragOverEffect(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  async createPage(page: TextNode, remote: string) {
    if (!this.eveesRemotes) throw new Error('eveesRemotes undefined');
    if (!this.client) throw new Error('client undefined');

    const remoteInstance = this.eveesRemotes.find(r => r.id === remote);
    if (!remoteInstance) throw new Error(`Remote not found for remote ${remote}`);

    const dataId = await EveesHelpers.createEntity(this.client, remoteInstance.store, page);
    const headId = await EveesHelpers.createCommit(this.client, remoteInstance.store, {
      dataId,
      parentsIds: []
    });
    return EveesHelpers.createPerspective(this.client, remoteInstance, {
      headId,
      parentId: this.uref
    });
  }

  async updateContent(newWiki: Wiki) {
    const store = this.getStore(this.remote, WikiBindings.WikiType);
    if (!store) throw new Error('store is undefined');

    const remote = this.eveesRemotes.find(r => r.id === this.remote);
    if (!remote) throw Error(`Remote not found for remote ${this.remote}`);

    const dataId = await EveesHelpers.createEntity(this.client, store, newWiki);
    const headId = await EveesHelpers.createCommit(this.client, remote.store, {
      dataId,
      parentsIds: this.currentHeadId ? [this.currentHeadId] : undefined
    });
    await EveesHelpers.updateHead(this.client, this.uref, headId);

    this.logger.info('updateContent()', newWiki);

    await this.load();
  }

  async replacePagePerspective(oldId, newId) {
    if (!this.wiki) throw new Error('wiki undefined');

    const ix = this.wiki.object.pages.findIndex(pageId => pageId === oldId);

    if (ix === -1) return;

    const result = await this.splicePages(this.wiki.object, [newId], ix, 1);
    if (!result.entity) throw Error('problem with splice pages');

    await this.updateContent(result.entity);
  }

  async splicePages(wikiObject: Wiki, pages: any[], index: number, count: number) {
    const getPages = pages.map(page => {
      if (typeof page !== 'string') {
        return this.createPage(page, this.remote);
      } else {
        return Promise.resolve(page);
      }
    });

    const pagesIds = await Promise.all(getPages);

    const newObject = { ...wikiObject };
    const removed = newObject.pages.splice(index, count, ...pagesIds);

    return {
      entity: newObject,
      removed
    };
  }

  async newPage(index?: number) {
    const wikiObject = this.wiki
      ? this.wiki.object
      : {
          title: '',
          pages: []
        };

    this.creatingNewPage = true;

    const newPage: TextNode = {
      text: '',
      type: TextType.Title,
      links: []
    };

    index = index === undefined ? wikiObject.pages.length : index;

    const result = await this.splicePages(wikiObject, [newPage], index, 0);
    if (!result.entity) throw Error('problem with splice pages');

    await this.updateContent(result.entity);

    this.selectPage(index);

    this.creatingNewPage = false;
  }

  async movePage(fromIndex: number, toIndex: number) {
    if (!this.wiki) throw new Error('wiki not defined');

    const { removed } = await this.splicePages(this.wiki.object, [], fromIndex, 1);
    const { entity } = await this.splicePages(this.wiki.object, removed as string[], toIndex, 0);

    await this.updateContent(entity);

    if (this.selectedPageIx === undefined) return;

    /** this page was moved */
    if (fromIndex === this.selectedPageIx) {
      this.selectPage(toIndex);
    } else {
      /** a non selected page was moved to the selected index */
      if (toIndex === this.selectedPageIx) {
        this.selectPage(fromIndex);
      }
    }
  }

  async removePage(pageIndex: number) {
    if (!this.wiki) throw new Error('wiki not defined');

    const { entity } = await this.splicePages(this.wiki.object, [], pageIndex, 1);
    await this.updateContent(entity);

    if (this.selectedPageIx === undefined) return;

    /** this page was removed */
    if (pageIndex === this.selectedPageIx) {
      this.selectPage(undefined);
    }

    /** a younger page was removed */
    if (pageIndex < this.selectedPageIx) {
      this.selectedPageIx = this.selectedPageIx - 1;
    }
  }

  async optionOnPage(pageIndex: number, option: string) {
    switch (option) {
      case 'move-up':
        this.movePage(pageIndex, pageIndex - 1);
        break;

      case 'move-down':
        this.movePage(pageIndex, pageIndex + 1);
        break;

      case 'remove':
        this.removePage(pageIndex);
        break;
    }
  }

  goToHome() {
    this.selectPage(undefined);
    if (this.isMobile) {
      this.isDrawerOpened = false;
    }
  }

  goBack() {
    this.dispatchEvent(new CustomEvent('back', { bubbles: true, composed: true }));
  }

  renderPageList(showOptions: boolean = true) {
    if (this.pagesList === undefined)
      return html`
        <uprtcl-loading class="empty-pages-loader"></uprtcl-loading>
      `;

    return html`
      ${this.pagesList.length === 0
        ? html`
            <div class="empty">
              <span><i>${this.t('wikis:no-pages-yet')}</i></span>
            </div>
          `
        : html`
            <uprtcl-list>
              ${this.pagesList.map((page, ix) => {
                // this.logger.log(`rendering page title ${page.id}`, menuConfig);
                return this.renderPageItem(page, ix, showOptions);
              })}
            </uprtcl-list>
          `}
      ${this.editableActual
        ? html`
            <div class="button-row">
              <uprtcl-button-loading
                icon="add_circle_outline"
                @click=${() => this.newPage()}
                loading=${this.creatingNewPage ? 'true' : 'false'}
              >
                ${this.t('wikis:new-page')}
              </uprtcl-button-loading>
            </div>
          `
        : html``}
    `;
  }

  renderPageItem(page: PageData, ix: number, showOptions: boolean) {
    const menuConfig: MenuConfig = {
      'move-up': {
        disabled: ix === 0,
        text: 'move up',
        graphic: 'arrow_upward'
      },
      'move-down': {
        disabled: ix === (this.pagesList as any[]).length - 1,
        text: 'move down',
        graphic: 'arrow_downward'
      },
      remove: {
        disabled: false,
        text: 'remove',
        graphic: 'clear'
      }
    };

    const text = htmlToText(page.title);
    const empty = text === '';
    const selected = this.selectedPageIx === ix;

    let classes: string[] = [];

    classes.push('page-item');
    if (empty) classes.push('title-empty');
    if (selected) classes.push('title-selected');

    return html`
      <div
        class=${classes.join(' ')}
        draggable="true"
        @dragstart=${e => this.handlePageDrag(e, page.id)}
        @click=${() => this.selectPage(ix)}
      >
        <div class="text-container">
          ${text.length < MAX_LENGTH ? text : `${text.slice(0, MAX_LENGTH)}...`}
        </div>
        ${this.editableActual && showOptions
          ? html`
              <div class="item-menu-container">
                <uprtcl-options-menu
                  class="options-menu"
                  @option-click=${e => this.optionOnPage(ix, e.detail.key)}
                  .config=${menuConfig}
                >
                </uprtcl-options-menu>
              </div>
            `
          : ''}
      </div>
    `;
  }

  render() {
    if (this.loading)
      return html`
        <uprtcl-loading></uprtcl-loading>
      `;

    this.logger.log('rendering wiki after loading');

    return html`
      <div class="app-content-with-nav">
        <div class="app-navbar" @dragover=${this.dragOverEffect} @drop=${this.handlePageDrop}>
          ${this.renderPageList()}
        </div>

        <div class="app-content">
          ${this.selectedPageIx !== undefined
            ? html`
                <wiki-page
                  id="wiki-page"
                  @nav-back=${() => this.selectPage(undefined)}
                  @page-title-changed=${() => this.loadPagesData()}
                  pageHash=${this.wiki ? this.wiki.object.pages[this.selectedPageIx] : ''}
                  color=${this.color}
                  wikiId=${this.uref}
                >
                </wiki-page>
              `
            : html`
                <div class="home-container">
                  <div class="evee-info">
                    <h1>List of pages</h1>
                  </div>
                </div>
              `}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      sharedStyles,
      css`
        :host {
          display: flex;
          flex: 1 1 0;
          flex-direction: column;
        }
        .app-content-with-nav {
          flex: 1 1 0;
          display: flex;
          flex-direction: row;
          position: relative;
        }
        .app-navbar {
          width: 260px;
          flex-shrink: 0;
        }
        .app-content {
          border-left: solid #cccccc 1px;
          min-width: 475px;
          max-width: calc(100% - 260px - 1px);
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        .empty-pages-loader {
          margin-top: 22px;
          display: block;
        }
        .page-item {
          min-height: 48px;
          cursor: pointer;
          width: calc(100% - 19px);
          display: flex;
          padding: 0px 3px 0px 16px;
          transition: all 0.1s ease-in;
        }
        .page-item .text-container {
          white-space: nowrap;
          overflow: hidden;
          max-width: calc(100% - 48px);
          overflow-x: hidden;
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .page-item .item-menu-container {
          display: flex;
          flex-direction: column;
          justify-content: center;
        }
        .page-item .item-menu-container .options-menu {
          --box-width: 160px;
        }
        .page-item:hover {
          background-color: #e8ecec;
        }
        .title-empty {
          color: #a2a8aa;
          font-style: italic;
        }
        .title-selected {
          font-weight: bold;
          background-color: rgb(200, 200, 200, 0.2);
        }
        .empty {
          width: 100%;
          text-align: center;
          padding-top: 24px;
          color: #a2a8aa;
        }
        .center-aligned {
          justify-content: center;
          align-items: center;
        }
        .button-row {
          width: calc(100% - 20px);
          padding: 16px 10px 8px 10px;
          display: flex;
        }
        .button-row uprtcl-button-loading {
          margin: 0 auto;
          width: 180px;
        }
        .home-container {
          text-align: center;
          height: auto;
          padding: 6vw 0vw;
        }
        .title-card-container {
          padding: 0px 5vw;
        }

        .section {
          text-align: center;
          width: 100%;
          max-width: 700px;
          margin: 0 auto;
          box-shadow: 0px 0px 4px 0px rgba(0, 0, 0, 0.2);
          margin-bottom: 36px;
          border-radius: 4px;
          background-color: rgb(255, 255, 255, 0.6);
          position: relative;
        }
        .section-header {
          font-weight: bold;
          padding: 2vw 0px 0.8vw 0px;
          font-size: 30px;
          border-style: solid 2px;
        }
        .section-content evees-author {
          display: inline-block;
          margin-left: 12px;
        }
        .section-content {
          padding-bottom: 2vw;
        }
        .official-name {
          font-size: 30px;
          font-weight: bold;
          color: #4e585c;
        }
        .by-3box {
          color: rgb(99, 102, 104);
          font-weight: 600;
          letter-spacing: 0.015em;
        }
        .context-menu {
          position: absolute;
          top: 6px;
          right: 6px;
          display: flex;
        }
        .pages-summary {
          max-height: 150px;
          min-height: 80px;
          overflow-y: auto;
          text-align: left;
          color: gray;
          padding-left: 12px;
        }
        .title-form {
          margin-top: 22px;
        }
      `
    ];
  }
}
