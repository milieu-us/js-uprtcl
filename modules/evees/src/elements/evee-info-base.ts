import { LitElement, property, html, css, query } from 'lit-element';

import { ApolloClient, gql } from 'apollo-boost';

import { ApolloClientModule } from '@uprtcl/graphql';
import { moduleConnect, Logger } from '@uprtcl/micro-orchestrator';
import { CortexModule, PatternRecognizer, Entity, Signed } from '@uprtcl/cortex';
import { DiscoveryModule, EntityCache, loadEntity } from '@uprtcl/multiplatform';
import { UprtclDialog } from '@uprtcl/common-ui';

import {
  RemoteMap,
  ProposalCreatedEvent,
  Perspective,
  PerspectiveDetails,
  Commit,
  getAuthority
} from '../types';
import { EveesBindings } from '../bindings';
import {
  UPDATE_HEAD,
  EXECUTE_PROPOSAL,
  DELETE_PERSPECTIVE,
  CREATE_PROPOSAL,
  FORK_PERSPECTIVE
} from '../graphql/queries';
import { EveesHelpers } from '../graphql/evees.helpers';
import { MergeStrategy } from '../merge/merge-strategy';
import { Evees } from '../services/evees';

import { EveesRemote } from '../services/evees.remote';

import { EveesWorkspace } from '../services/evees.workspace';
import { EveesDiff } from './evees-diff';

interface PerspectiveData {
  id?: string;
  perspective?: Perspective;
  details?: PerspectiveDetails;
  canWrite?: Boolean;
  permissions?: any;
  head?: Entity<Commit>;
  data?: Entity<any>;
}

export class EveesInfoBase extends moduleConnect(LitElement) {
  logger = new Logger('EVEES-INFO');

  @property({ type: String, attribute: 'uref' })
  uref!: string;

  @property({ type: String, attribute: 'first-uref' })
  firstRef!: string;

  @property({ type: String, attribute: 'default-remote' })
  defaultRemoteId: string | undefined = undefined;

  @property({ type: String, attribute: 'evee-color' })
  eveeColor!: string;

  @property({ type: String, attribute: false })
  entityType: string | undefined = undefined;

  @property({ attribute: false })
  loading: Boolean = false;

  @property({ attribute: false })
  isLogged: boolean = false;

  @property({ attribute: false })
  isLoggedOnDefault;

  @property({ attribute: false })
  forceUpdate: string = 'true';

  @property({ attribute: false })
  showUpdatesDialog: boolean = false;

  @property({ attribute: false })
  loggingIn: boolean = false;

  @property({ attribute: false })
  creatingNewPerspective: boolean = false;

  @property({ attribute: false })
  proposingUpdate: boolean = false;

  @property({ attribute: false })
  makingPublic: boolean = false;

  @property({ attribute: false })
  firstHasChanges!: boolean;

  @query('#updates-dialog')
  updatesDialogEl!: UprtclDialog;

  @query('#evees-update-diff')
  eveesDiffEl!: EveesDiff;

  perspectiveData!: PerspectiveData;
  pullWorkspace!: EveesWorkspace;

  protected client!: ApolloClient<any>;
  protected merge!: MergeStrategy;
  protected evees!: Evees;
  protected remote!: EveesRemote;
  protected recognizer!: PatternRecognizer;
  protected cache!: EntityCache;
  protected remoteMap!: RemoteMap;
  protected defaultRemote: EveesRemote | undefined = undefined;

  async firstUpdated() {
    this.client = this.request(ApolloClientModule.bindings.Client);
    this.merge = this.request(EveesBindings.MergeStrategy);
    this.evees = this.request(EveesBindings.Evees);
    this.recognizer = this.request(CortexModule.bindings.Recognizer);
    this.cache = this.request(DiscoveryModule.bindings.EntityCache);
    this.remoteMap = this.request(EveesBindings.RemoteMap);

    if (this.defaultRemoteId !== undefined) {
      this.defaultRemote = (this.requestAll(EveesBindings.EveesRemote) as EveesRemote[]).find(
        remote => remote.id === this.defaultRemoteId
      );
    }

    this.load();
  }

  updated(changedProperties) {
    if (changedProperties.get('uref') !== undefined) {
      this.logger.info('updated() reload', { changedProperties });
      this.load();
    }

    if (changedProperties.has('defaultAuthority')) {
      this.defaultRemote = (this.requestAll(EveesBindings.EveesRemote) as EveesRemote[]).find(
        remote => remote.id === this.defaultRemoteId
      );
    }
  }

  async load() {
    this.remote = await this.evees.getPerspectiveRemoteById(this.uref);

    const entity = await loadEntity(this.client, this.uref);
    if (!entity) throw Error(`Entity not found ${this.uref}`);

    this.entityType = this.recognizer.recognizeType(entity);

    this.loading = true;

    if (this.entityType === EveesBindings.PerspectiveType) {
      const headId = await EveesHelpers.getPerspectiveHeadId(this.client, this.uref);
      const context = await EveesHelpers.getPerspectiveContext(this.client, this.uref);

      const head = headId !== undefined ? await loadEntity<Commit>(this.client, headId) : undefined;
      const data = await EveesHelpers.getPerspectiveData(this.client, this.uref);

      const canWrite = await this.remote.canWrite(this.uref);

      this.perspectiveData = {
        id: this.uref,
        details: {
          context: context,
          headId: headId
        },
        perspective: (entity.object as Signed<Perspective>).payload,
        canWrite: canWrite,
        head,
        data
      };

      this.logger.info('load', { perspectiveData: this.perspectiveData });

      this.checkPull();
    }

    if (this.entityType === EveesBindings.CommitType) {
      const head = await loadEntity<Commit>(this.client, this.uref);
      const data = await EveesHelpers.getCommitData(this.client, this.uref);

      this.perspectiveData = {
        head,
        data
      };
    }

    this.isLogged = await this.remote.isLogged();
    this.isLoggedOnDefault =
      this.defaultRemote !== undefined ? await this.defaultRemote.isLogged() : false;

    this.reloadChildren();
    this.loading = false;
  }

  async checkPull() {
    if (this.entityType !== EveesBindings.PerspectiveType) {
      this.firstHasChanges = false;
    }

    if (this.uref === this.firstRef || !this.perspectiveData.canWrite) {
      this.firstHasChanges = false;
      return;
    }

    if (this.perspectiveData.perspective === undefined) throw new Error('undefined');

    const config = {
      forceOwner: true,
      remote: this.perspectiveData.perspective.remote,
      path: this.perspectiveData.perspective.path,
      canWrite: this.remote.userId,
      parentId: this.uref
    };

    this.pullWorkspace = new EveesWorkspace(this.client, this.recognizer);

    await this.merge.mergePerspectivesExternal(
      this.uref,
      this.firstRef,
      this.pullWorkspace,
      config
    );

    this.logger.info('checkPull()');
    this.firstHasChanges = this.pullWorkspace.hasUpdates();
  }

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener('permissions-updated', ((e: CustomEvent) => {
      this.logger.info('CATCHED EVENT: permissions-updated ', {
        perspectiveId: this.uref,
        e
      });
      e.stopPropagation();
      this.load();
    }) as EventListener);
  }

  reloadChildren() {
    if (this.forceUpdate === 'true') {
      this.forceUpdate = 'false';
    } else {
      this.forceUpdate = 'true';
    }
  }

  async login() {
    if (this.defaultRemote === undefined) throw new Error('default remote undefined');
    this.loggingIn = true;
    await this.defaultRemote.login();

    await this.client.resetStore();
    this.reloadChildren();
    this.load();
    this.loggingIn = false;
  }

  async logout() {
    if (this.defaultRemote === undefined) throw new Error('default remote undefined');
    await this.defaultRemote.logout();

    await this.client.resetStore();
    this.reloadChildren();
    this.load();
  }

  async otherPerspectiveMerge(
    fromPerspectiveId: string,
    toPerspectiveId: string,
    isProposal: boolean
  ) {
    this.logger.info(
      `merge ${fromPerspectiveId} on ${toPerspectiveId} - isProposal: ${isProposal}`
    );

    const workspace = new EveesWorkspace(this.client, this.recognizer);
    const toRemoteId = await EveesHelpers.getPerspectiveRemoteId(this.client, toPerspectiveId);

    const config = {
      forceOwner: true,
      remote: toRemoteId,
      parentId: toPerspectiveId
    };

    await this.merge.mergePerspectivesExternal(
      toPerspectiveId,
      fromPerspectiveId,
      workspace,
      config
    );

    const confirm = await this.updatesDialog(workspace, isProposal ? 'propose' : 'merge', 'cancel');

    if (!confirm) {
      return;
    }

    const toHeadId = await EveesHelpers.getPerspectiveHeadId(this.client, toPerspectiveId);
    const fromHeadId = await EveesHelpers.getPerspectiveHeadId(this.client, fromPerspectiveId);

    if (fromHeadId === undefined) throw new Error(`undefuned head for ${fromPerspectiveId}`);

    if (isProposal) {
      await this.createMergeProposal(
        fromPerspectiveId,
        toPerspectiveId,
        fromHeadId,
        toHeadId,
        workspace
      );
    } else {
      await workspace.execute(this.client);
    }

    if (this.uref !== toPerspectiveId) {
      this.checkoutPerspective(toPerspectiveId);
    } else {
      /** reload perspectives-list */
      this.reloadChildren();
    }
  }

  async createMergeProposal(
    fromPerspectiveId: string,
    toPerspectiveId: string,
    fromHeadId: string,
    toHeadId: string | undefined,
    workspace: EveesWorkspace
  ): Promise<void> {
    // TODO: handle proposals and updates on multiple authorities.
    const remote = await EveesHelpers.getPerspectiveRemoteId(this.client, toPerspectiveId);

    const not = await workspace.isSingleAuthority(remote);
    if (!not) throw new Error('cant create merge proposals on multiple authorities yet');

    /** create commits and data */
    await workspace.executeCreate(this.client);
    await workspace.precacheNewPerspectives(this.client);

    const result = await this.client.mutate({
      mutation: CREATE_PROPOSAL,
      variables: {
        toPerspectiveId,
        fromPerspectiveId,
        toHeadId,
        fromHeadId,
        newPerspectives: workspace.getNewPerspectives(),
        updates: workspace.getUpdates()
      }
    });

    const proposalId = result.data.addProposal.id;

    this.logger.info('created proposal');

    this.dispatchEvent(
      new ProposalCreatedEvent({
        detail: { proposalId, remote },
        cancelable: true,
        composed: true,
        bubbles: true
      })
    );
  }

  async executeProposal(e: CustomEvent) {
    if (!this.client) throw new Error('client undefined');

    const proposalId = e.detail.proposalId;
    const perspectiveId = e.detail.perspectiveId;

    await this.client.mutate({
      mutation: EXECUTE_PROPOSAL,
      variables: {
        proposalId: proposalId,
        perspectiveId: perspectiveId
      }
    });

    this.logger.info('accepted proposal', { proposalId });

    this.dispatchEvent(
      new CustomEvent('checkout-perspective', {
        detail: {
          perspectiveId: perspectiveId
        },
        composed: true,
        bubbles: true
      })
    );

    this.reloadChildren();
  }

  async newPerspectiveClicked() {
    this.creatingNewPerspective = true;

    const result = await this.client.mutate({
      mutation: FORK_PERSPECTIVE,
      variables: {
        perspectiveId: this.uref,
        remote: this.defaultRemoteId
      }
    });

    const newPerspectiveId = result.data.forkPerspective.id;
    this.checkoutPerspective(newPerspectiveId);

    this.logger.info('newPerspectiveClicked() - perspective created', {
      id: newPerspectiveId
    });
    this.creatingNewPerspective = false;
  }

  checkoutPerspective(perspectiveId: string) {
    this.dispatchEvent(
      new CustomEvent('checkout-perspective', {
        detail: {
          perspectiveId: perspectiveId
        },
        composed: true,
        bubbles: true
      })
    );
  }

  async proposeMergeClicked() {
    this.proposingUpdate = true;
    await this.otherPerspectiveMerge(this.uref, this.firstRef, true);
    this.proposingUpdate = false;
  }

  perspectiveTextColor() {
    if (this.uref === this.firstRef) {
      return '#37352f';
    } else {
      return '#ffffff';
    }
  }

  async delete() {
    if (!this.client) throw new Error('client undefined');

    await this.client.mutate({
      mutation: DELETE_PERSPECTIVE,
      variables: {
        perspectiveId: this.uref
      }
    });

    this.checkoutPerspective(this.firstRef);
  }

  async updatesDialog(
    workspace: EveesWorkspace,
    primaryText: string,
    secondaryText: string
  ): Promise<boolean> {
    this.showUpdatesDialog = true;
    await this.updateComplete;

    this.updatesDialogEl.primaryText = primaryText;
    this.updatesDialogEl.secondaryText = secondaryText;
    this.updatesDialogEl.showSecondary = secondaryText !== undefined ? 'true' : 'false';

    this.eveesDiffEl.workspace = workspace;

    return new Promise(resolve => {
      this.updatesDialogEl.resolved = value => {
        this.showUpdatesDialog = false;
        resolve(value);
      };
    });
  }

  renderUpdatesDialog() {
    return html`
      <uprtcl-dialog id="updates-dialog">
        <evees-update-diff id="evees-update-diff"></evees-update-diff>
      </uprtcl-dialog>
    `;
  }

  renderLoading() {
    return html`
      <uprtcl-loading></uprtcl-loading>
    `;
  }

  renderInfo() {
    return html`
      <div class="perspective-details">
        <div class="prop-name"><h2>${this.entityType}</h2></div>
        ${this.entityType === EveesBindings.PerspectiveType
          ? html`
              <div class="prop-name">perspective-id</div>
              <pre class="prop-value">${JSON.stringify(this.perspectiveData.id)}</pre>

              <div class="prop-name">context</div>
              <pre class="prop-value">
${this.perspectiveData.details ? this.perspectiveData.details.context : 'undefined'}</pre
              >

              <div class="prop-name">authority</div>
              <pre class="prop-value">
${this.perspectiveData.perspective ? getAuthority(this.perspectiveData.perspective) : ''}</pre
              >
            `
          : ''}

        <div class="prop-name">head</div>
        <pre class="prop-value">${JSON.stringify(this.perspectiveData.head, undefined, 2)}</pre>

        <div class="prop-name">data</div>
        <pre class="prop-value">${JSON.stringify(this.perspectiveData.data, undefined, 2)}</pre>
      </div>
    `;
  }

  static get styles() {
    return [
      css`
        .perspective-details {
          padding: 5px;
          text-align: left;
          max-width: calc(100vw - 72px);
        }

        .prop-name {
          font-weight: bold;
          width: 100%;
        }

        .prop-value {
          font-family: Lucida Console, Monaco, monospace;
          font-size: 12px;
          text-align: left;
          background-color: #a0a3cb;
          color: #1c1d27;
          padding: 16px 16px;
          margin-bottom: 16px;
          border-radius: 6px;
          width: 100%;
          overflow: auto;
          width: calc(100% - 32px);
          overflow-x: auto;
        }
      `
    ];
  }
}
