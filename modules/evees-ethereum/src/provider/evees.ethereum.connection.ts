import { Logger } from '@uprtcl/micro-orchestrator';
import { EthereumConnection, EthereumContractOptions, EthereumContract } from '@uprtcl/ethereum-provider';
import { BlockchainConnection } from '@uprtcl/evees-blockchain';
import { cidToHex32, bytes32ToCid } from '@uprtcl/ipfs-provider';


import { abi as abiRoot, networks as networksRoot } from './contracts-json/UprtclRoot.min.json';
const UprtclRoot = { abi: abiRoot, networks: networksRoot };
const ZERO_ADDRESS = '0x' + new Array(40).fill(0).join('');

import { UPDATED_HEAD } from './common';

export class EveesEthereumConnection implements BlockchainConnection {
  logger: Logger = new Logger('EveesEthereum');

  public uprtclRoot: EthereumContract;

  constructor(protected connection: EthereumConnection, uprtclRootOptions: EthereumContractOptions = {
    contract: UprtclRoot as any
  }) {
    this.uprtclRoot = new EthereumContract(uprtclRootOptions, connection);
  }

  async ready() {
    await Promise.all([this.connection.ready(), this.uprtclRoot.ready()]);
  }

  async getHead(userId: string, block?: number) {
    const filter = this.uprtclRoot.contractInstance.filters.HeadUpdated(userId, null, null);
    const events = await this.uprtclRoot.contractInstance.queryFilter(filter, 0, block);

    if (events.length === 0) return undefined;
    const last = events.sort((e1, e2) => (e1.blockNumber > e2.blockNumber ? 1 : -1)).pop();
    if (!last) return undefined;
    if (!last.args) return undefined;

    return bytes32ToCid([last.args.val1, last.args.val0]);
  }

  async updateHead(head: string) {
    const headCidParts = cidToHex32(head);

    return this.uprtclRoot.send(UPDATED_HEAD, [
      headCidParts[0],
      headCidParts[1],
      ZERO_ADDRESS
    ]);    
  }

  get account() {
    return this.connection.account;
  }
  getNetworkId() {
    return `eth-${this.connection.getNetworkId()}`;;
  }
  async getLatestBlock() {
    return this.connection.getLatestBlock();
  }
  async canSign() {
    return this.connection.canSign();
  }
  async connectWallet() {
    return this.connection.connectWallet();
  }
  async disconnectWallet() {
    return this.connection.disconnectWallet();
  }
}
