import { CASStore } from '@uprtcl/multiplatform';
import { Logger } from '@uprtcl/micro-orchestrator';
import {
  EthereumConnection,
  EthereumContractOptions,
  EthereumContract
} from '@uprtcl/ethereum-provider';

import { abi as abiRoot, networks as networksRoot } from './contracts-json/UprtclRoot.min.json';
import {
  abi as abiDetails,
  networks as networksDetails
} from './contracts-json/UprtclDetails.min.json';
import {
  abi as abiProposals,
  networks as networksProposals
} from './contracts-json/UprtclProposals.min.json';
import {
  abi as abiWrapper,
  networks as networksWrapper
} from './contracts-json/UprtclWrapper.min.json';

const UprtclRoot = { abi: abiRoot, networks: networksRoot };
const UprtclDetails = { abi: abiDetails, networks: networksDetails };
const UprtclProposals = { abi: abiProposals, networks: networksProposals };
const UprtclWrapper = { abi: abiWrapper, networks: networksWrapper };

import {
  EveesRemote,
  Perspective,
  PerspectiveDetails,
  NewPerspectiveData,
  Secured,
  ProposalsProvider
} from '@uprtcl/evees';

import {
  UPDATE_PERSP_DETAILS,
  INIT_PERSP,
  GET_CONTEXT_HASH,
  cidToHex32,
  bytes32ToCid,
  GET_PERSP_HASH,
  INIT_PERSP_BATCH,
  UPDATE_OWNER,
  UPDATED_HEAD,
  getEthPerspectiveHead,
  getEthPerspectiveContext,
  ZERO_HEX_32,
  ZERO_ADDRESS,
  hashToId,
  PerspectiveCreator,
  GET_PERSP_OWNER
} from './common';
import { EveesAccessControlEthereum } from './evees-acl.ethereum';

const evees_if = 'evees-v0';

export class EveesEthereum implements EveesRemote, PerspectiveCreator {
  logger: Logger = new Logger('EveesEtereum');

  accessControl: EveesAccessControlEthereum;

  public uprtclRoot: EthereumContract;
  public uprtclDetails: EthereumContract;
  public uprtclProposals: EthereumContract;
  public uprtclWrapper: EthereumContract;

  constructor(
    public ethConnection: EthereumConnection,
    public store: CASStore,
    public proposals: ProposalsProvider,
    uprtclRootOptions: EthereumContractOptions = {
      contract: UprtclRoot as any
    },
    uprtclDetailsOptions: EthereumContractOptions = {
      contract: UprtclDetails as any
    },
    uprtclProposalsOptions: EthereumContractOptions = {
      contract: UprtclProposals as any
    },
    uprtclWrapperOptions: EthereumContractOptions = {
      contract: UprtclWrapper as any
    }
  ) {
    this.uprtclRoot = new EthereumContract(uprtclRootOptions, ethConnection);
    this.uprtclDetails = new EthereumContract(uprtclDetailsOptions, ethConnection);
    this.uprtclProposals = new EthereumContract(uprtclProposalsOptions, ethConnection);
    this.uprtclWrapper = new EthereumContract(uprtclWrapperOptions, ethConnection);

    this.accessControl = new EveesAccessControlEthereum(this.uprtclRoot);
  }

  get id() {
    return `eth-${this.ethConnection.getNetworkId()}:${evees_if}`;
  }

  get defaultPath() {
    return this.uprtclRoot.contractInstance.address
      ? this.uprtclRoot.contractInstance.address.toLocaleLowerCase()
      : '';
  }

  get userId() {
    return this.ethConnection.getCurrentAccount();
  }

  /**
   * @override
   */
  async ready(): Promise<void> {
    await Promise.all([
      this.uprtclRoot.ready(),
      this.uprtclDetails.ready(),
      this.uprtclProposals.ready(),
      this.uprtclWrapper.ready(),
      this.store.ready()
    ]);
  }

  async persistPerspectiveEntity(secured: Secured<Perspective>) {
    const perspectiveId = await this.store.create(secured.object);
    this.logger.log(`[ETH] persistPerspectiveEntity - added to IPFS`, perspectiveId);

    if (secured.id && secured.id != perspectiveId) {
      throw new Error(
        `perspective ID computed by IPFS ${perspectiveId} is not the same as the input one ${secured.id}.`
      );
    }

    return perspectiveId;
  }

  async canWrite(uref: string) {
    return this.accessControl.canWrite(uref, this.userId);
  }

  /** */
  async getOwnerOfNewPerspective(perspectiveData: NewPerspectiveData) {
    let owner: String | undefined = undefined;
    if (perspectiveData.parentId !== undefined) {
      owner = await this.accessControl.getOwner(perspectiveData.parentId);
    } else {
      owner =
        perspectiveData.canWrite !== undefined
          ? perspectiveData.canWrite
          : this.ethConnection.getCurrentAccount();
    }
    return owner;
  }

  async createPerspective(perspectiveData: NewPerspectiveData): Promise<void> {
    const secured = perspectiveData.perspective;
    const details = perspectiveData.details;
    const owner = await this.getOwnerOfNewPerspective(perspectiveData);
    /** Store the perspective data in the data layer */
    const perspectiveId = await this.persistPerspectiveEntity(secured);

    const headCidParts = details.headId ? cidToHex32(details.headId) : [ZERO_HEX_32, ZERO_HEX_32];

    const newPerspective = {
      perspectiveId: perspectiveId,
      headCid1: headCidParts[0],
      headCid0: headCidParts[1],
      owner: owner
    };

    const context = details.context ? details.context : '';

    /** TX is sent, and await to force order (preent head update on an unexisting perspective) */
    await this.uprtclDetails.send(INIT_PERSP, [
      { perspective: newPerspective, context: context },
      this.uprtclDetails.userId
    ]);
  }

  async preparePerspectives(newPerspectivesData: NewPerspectiveData[]) {
    const persistPromises = newPerspectivesData.map(perspectiveData => {
      return this.persistPerspectiveEntity(perspectiveData.perspective);
    });

    await Promise.all(persistPromises);

    const ethPerspectivesDataPromises = newPerspectivesData.map(
      async (perspectiveData): Promise<any> => {
        const owner = await this.getOwnerOfNewPerspective(perspectiveData);

        const headCidParts = perspectiveData.details.headId
          ? cidToHex32(perspectiveData.details.headId)
          : [ZERO_HEX_32, ZERO_HEX_32];

        const perspective = {
          perspectiveId: perspectiveData.perspective.id,
          headCid1: headCidParts[0],
          headCid0: headCidParts[1],
          owner: owner
        };

        return { perspective, context: perspectiveData.details.context };
      }
    );

    const ethPerspectivesData = await Promise.all(ethPerspectivesDataPromises);

    return ethPerspectivesData;
  }

  async createPerspectiveBatch(newPerspectivesData: NewPerspectiveData[]): Promise<void> {
    const ethPerspectivesData = await this.preparePerspectives(newPerspectivesData);

    /** TX is sent, and await to force order (preent head update on an unexisting perspective) */
    await this.uprtclDetails.send(INIT_PERSP_BATCH, [
      ethPerspectivesData,
      this.ethConnection.getCurrentAccount()
    ]);
  }

  /**
   * @override
   */
  async updatePerspective(perspectiveId: string, details: PerspectiveDetails): Promise<void> {
    const perspectiveIdHash = await this.uprtclRoot.call(GET_PERSP_HASH, [perspectiveId]);

    if (details.context !== undefined) {
      await this.uprtclDetails.send(UPDATE_PERSP_DETAILS, [
        perspectiveIdHash,
        details.context ? details.context : ''
      ]);
    }

    if (details.headId !== undefined) {
      const headCidParts = cidToHex32(details.headId);

      await this.uprtclRoot.send(UPDATED_HEAD, [
        perspectiveIdHash,
        headCidParts[0],
        headCidParts[1],
        ZERO_ADDRESS
      ]);
    }
  }

  async hashToId(hash: string) {
    return hashToId(this.uprtclRoot, hash);
  }

  /**
   * @override
   */
  async getContextPerspectives(context: string): Promise<string[]> {
    const contextHash = await this.uprtclDetails.call(GET_CONTEXT_HASH, [context]);

    let contextFilter = this.uprtclDetails.contractInstance.filters.PerspectiveDetailsSet(
      null,
      contextHash,
      null
    );

    let perspectiveContextUpdatedEvents = await this.uprtclDetails.contractInstance.queryFilter(
      contextFilter,
      0
    );

    const perspectiveIds = await Promise.all(
      perspectiveContextUpdatedEvents.map(event =>
        this.hashToId(event.args ? event.args.perspectiveIdHash : undefined)
      )
    );
    this.logger.log(`[ETH] getContextPerspectives of ${context}`, perspectiveIds);

    return perspectiveIds;
  }

  /**
   * @override
   */
  async getPerspective(perspectiveId: string): Promise<PerspectiveDetails> {
    const perspectiveIdHash = await this.uprtclRoot.call(GET_PERSP_HASH, [perspectiveId]);

    const context = await getEthPerspectiveContext(
      this.uprtclDetails.contractInstance,
      perspectiveIdHash
    );
    const ethPerspective = await getEthPerspectiveHead(
      this.uprtclRoot.contractInstance,
      perspectiveIdHash
    );

    const headId =
      ethPerspective !== undefined
        ? bytes32ToCid([ethPerspective.headCid1, ethPerspective.headCid0])
        : undefined;

    return { name: '', context, headId };
  }

  async deletePerspective(perspectiveId: string): Promise<void> {
    const perspectiveIdHash = await this.uprtclRoot.call(GET_PERSP_HASH, [perspectiveId]);
    let contextHash = ZERO_HEX_32;

    /** set null values */
    await this.uprtclDetails.send(UPDATE_PERSP_DETAILS, [
      perspectiveIdHash,
      contextHash,
      '',
      '',
      ''
    ]);

    /** set null owner (cannot be undone) */
    const ZERO_ADD = '0x' + new Array(40).fill(0).join('');
    await this.uprtclRoot.send(UPDATE_OWNER, [perspectiveIdHash, ZERO_ADD]);
  }

  async isLogged() {
    return this.ethConnection.canSign();
  }
  async login(): Promise<void> {
    await this.ethConnection.connectWallet();
  }
  logout(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  connect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
  isConnected(): Promise<boolean> {
    throw new Error('Method not implemented.');
  }
  disconnect(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
