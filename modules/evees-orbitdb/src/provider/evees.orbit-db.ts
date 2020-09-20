import { Logger } from '@uprtcl/micro-orchestrator';
import { Signed } from '@uprtcl/cortex';
import { CASStore } from '@uprtcl/multiplatform';

import {
  Secured,
  Perspective,
  PerspectiveDetails,
  NewPerspectiveData,
  EveesRemote,
  ProposalsProvider
} from '@uprtcl/evees';

import { EveesAccessControlOrbitDB } from './evees-acl.orbit-db';
import { CustomStores, OrbitDBCustom } from './orbit-db.custom';
import { EntropyGenerator } from '../identity-providers/entropy.generator';
import { ContextAccessController } from './context-access-controller';
import { ProposalsAccessController } from './proposals-access-controller';

const evees_if = 'evees-v0';
// const timeout = 200;
const defaultDetails: PerspectiveDetails = {
  name: '',
  context: undefined,
  headId: undefined
};

const notLogged = () => new Error('must be logged in to use this method');

enum EveesOrbitDBEntities {
  Perspective = 'PERSPECTIVE',
  Context = 'CONTEXT',
  Proposal = 'PROPOSAL',
  ProposalsToPerspective = 'PROPOSALS_TO_PERSPECTIVE'
}

export interface OrbitDBConfig {
  pinnerUrl: string;
  entropy: EntropyGenerator;
  ipfs?: any;
}

export class EveesOrbitDB implements EveesRemote {
  logger: Logger = new Logger('EveesOrbitDB');
  accessControl: any;
  proposals!: ProposalsProvider;
  orbitdbcustom: OrbitDBCustom;

  constructor(protected config: OrbitDBConfig, public store: CASStore) {
    const acls = [ContextAccessController, ProposalsAccessController];
    const stores: CustomStores = {
      [EveesOrbitDBEntities.Perspective]: {
        recognize: (entity: any) => entity.type === EveesOrbitDBEntities.Perspective,
        type: 'eventlog',
        name: () => 'perspective-store',
        options: (perspective: Perspective) => {
          return {
            accessController: { type: 'ipfs', write: [perspective.creatorId] },
            meta: { timestamp: perspective.timestamp }
          };
        }
      },
      [EveesOrbitDBEntities.Context]: {
        recognize: (entity: any) => entity.type === EveesOrbitDBEntities.Context,
        type: 'set',
        name: (entity: any) => `context-store/${entity.context}`,
        options: (entity: any) => {
          return {
            accessController: { type: 'context', write: ['*'] }
          };
        }
      },
      [EveesOrbitDBEntities.Proposal]: {
        recognize: (entity: any) => entity.type === EveesOrbitDBEntities.Proposal,
        type: 'eventlog',
        name: () => 'proposal-store',
        options: (perspective: Perspective) => {
          return {
            accessController: { type: 'ipfs', write: [perspective.creatorId] },
            meta: { timestamp: perspective.timestamp }
          };
        }
      },
      [EveesOrbitDBEntities.ProposalsToPerspective]: {
        recognize: (entity: any) => entity.type === EveesOrbitDBEntities.ProposalsToPerspective,
        type: 'set',
        name: (entity: any) => `proposals-store/${entity.toPerspectiveId}`,
        options: (entity: any) => {
          return {
            accessController: { type: 'proposals', write: ['*'] }
          };
        }
      }
    };
    this.orbitdbcustom = new OrbitDBCustom(
      stores,
      acls,
      config.entropy,
      config.pinnerUrl,
      config.ipfs
    );
    this.accessControl = new EveesAccessControlOrbitDB(this.store);
  }

  get id() {
    return `orbitdb:${evees_if}`;
  }

  get defaultPath() {
    return '';
  }

  get userId() {
    if (!this.orbitdbcustom) return undefined;
    return this.orbitdbcustom.identity.id;
  }

  canWrite(uref: string): Promise<boolean> {
    return this.accessControl.canWrite(uref, this.userId);
  }

  /**
   * @override
   */
  async ready(): Promise<void> {
    await Promise.all([this.orbitdbcustom.ready(), this.store.ready()]);
  }

  async persistPerspectiveEntity(secured: Secured<Perspective>) {
    const perspectiveId = await this.store.create(secured.object);
    this.logger.log(`[OrbitDB] persistPerspectiveEntity - added to IPFS`, perspectiveId);

    if (secured.id && secured.id !== perspectiveId) {
      throw new Error(
        `perspective ID computed by IPFS ${perspectiveId} is not the same as the input one ${secured.id}.`
      );
    }

    this.logger.log('persisting', secured);

    return perspectiveId;
  }

  async getPerspectiveStore(perspectiveId: string, pin: boolean = false) {
    if (!this.orbitdbcustom) throw new Error('orbit db connection undefined');

    const signedPerspective = (await this.store.get(perspectiveId)) as Signed<Perspective>;

    this.logger.log('getting', { perspectiveId, signedPerspective });

    return this.orbitdbcustom.getStore(
      { type: EveesOrbitDBEntities.Perspective, ...signedPerspective.payload },
      pin
    );
  }

  async createPerspective(perspectiveData: NewPerspectiveData): Promise<void> {
    this.logger.log('createPerspective', perspectiveData);

    if (!(await this.isLogged())) throw notLogged();
    const secured = perspectiveData.perspective;
    const details = perspectiveData.details;
    // const canWrite = perspectiveData.canWrite;

    /** validate */
    if (!secured.object.payload.remote) throw new Error('remote cannot be empty');

    /** Store the perspective data in the data layer */
    const perspectiveId = await this.persistPerspectiveEntity(secured);

    await this.updatePerspectiveInternal(perspectiveId, details, true);
  }

  async createPerspectiveBatch(newPerspectivesData: NewPerspectiveData[]): Promise<void> {
    if (!(await this.isLogged())) throw notLogged();
    await Promise.all(newPerspectivesData.map(this.createPerspective.bind(this)));
  }

  public async updatePerspective(perspectiveId: string, details: PerspectiveDetails) {
    return this.updatePerspectiveInternal(perspectiveId, details, false);
  }

  private async updatePerspectiveInternal(
    perspectiveId: string,
    details: PerspectiveDetails,
    pin: boolean
  ): Promise<void> {
    this.logger.log('updatePerspective', { perspectiveId, details });
    if (!(await this.isLogged())) throw notLogged();
    if (!this.orbitdbcustom) throw new Error('orbit db connection undefined');
    if (details.name) throw new Error('details.name is not supported');

    const currentDetails: PerspectiveDetails = await this.getPerspective(perspectiveId);

    details = Object.keys(details).reduce(
      (a, c) => (details[c] === undefined ? a : { ...a, [c]: details[c] }),
      {}
    );

    const newDetails: PerspectiveDetails = { ...currentDetails, ...details };

    const headChange = currentDetails.headId !== newDetails.headId;

    if (headChange) {
      const perspectiveStore = await this.getPerspectiveStore(perspectiveId, pin);
      await perspectiveStore.add(newDetails);
    }

    const contextChange = currentDetails.context !== newDetails.context;

    if (contextChange && currentDetails.context) {
      const contextStore = await this.orbitdbcustom.getStore({
        type: EveesOrbitDBEntities.Context,
        context: currentDetails.context
      });
      await contextStore.delete(perspectiveId);
    }
    if (contextChange && newDetails.context) {
      const contextStore = await this.orbitdbcustom.getStore(
        {
          type: EveesOrbitDBEntities.Context,
          context: newDetails.context
        },
        pin
      );
      await contextStore.add(perspectiveId);
    }
    this.logger.log('updatePerspective - done', { perspectiveId, details });
  }

  /**
   * @override
   */
  async getContextPerspectives(context: string): Promise<string[]> {
    this.logger.log('getContextPerspectives', { context });
    if (!this.orbitdbcustom) throw new Error('orbit db connection undefined');

    const contextStore = await this.orbitdbcustom.getStore({
      type: EveesOrbitDBEntities.Context,
      context
    });
    const perspectiveIds = [...contextStore.values()];

    this.logger.log(`[OrbitDB] getContextPerspectives of ${context}`, perspectiveIds);

    this.logger.log('getContextPerspectives - done ', {
      context,
      perspectiveIds
    });
    return perspectiveIds;
  }

  /**
   * @override
   */
  async getPerspective(perspectiveId: string): Promise<PerspectiveDetails> {
    const perspectiveStore = await this.getPerspectiveStore(perspectiveId);
    const [latestEntry] = perspectiveStore.iterator({ limit: 1 }).collect();

    const output = latestEntry ? latestEntry.payload.value : defaultDetails;
    return { ...output };
  }

  async deletePerspective(perspectiveId: string): Promise<void> {
    if (!(await this.isLogged())) throw notLogged();
    if (!this.orbitdbcustom) throw new Error('orbit db connection undefined');

    const perspectiveStore = await this.getPerspectiveStore(perspectiveId);
    const [latestEntry] = perspectiveStore.iterator({ limit: 1 }).collect();

    const context = latestEntry && latestEntry.payload.value.context;
    if (context) {
      const contextStore = await this.orbitdbcustom.getStore({
        type: EveesOrbitDBEntities.Context,
        context
      });
      await contextStore.delete(perspectiveId);
    }

    await perspectiveStore.drop();
  }

  async isLogged(): Promise<boolean> {
    return this.orbitdbcustom.isLogged();
  }

  async login(): Promise<void> {
    return this.orbitdbcustom.login();
  }

  async logout(): Promise<void> {
    return this.orbitdbcustom.logout();
  }

  async connect(): Promise<void> {}

  async isConnected(): Promise<boolean> {
    return true;
  }

  async disconnect(): Promise<void> {}
}
