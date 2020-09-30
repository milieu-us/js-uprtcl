import { ProposalLogic, ProposalStatus, VoteValue } from './proposal.config.types';
import { ProposalManifest } from './types';

export class ProposalLogicQuorum implements ProposalLogic {
  constructor(
    protected manifest: ProposalManifest,
    protected votes: any[],
    protected time: number
  ) {}

  getVotes() {
    return this.votes;
  }

  status() {
    if (this.time < this.manifest.block + this.manifest.config.duration) {
      return ProposalStatus.Pending;
    }

    const nYes = this.votes.filter(v => v === VoteValue.Yes).length;
    const nNo = this.votes.filter(v => v === VoteValue.No).length;

    const N = this.votes.length;
    const nVoted = nYes + nNo;

    if (nVoted / N < this.manifest.config.quorum) {
      return ProposalStatus.Rejected;
    }

    if (nYes / N >= this.manifest.config.thresehold) {
      return ProposalStatus.Accepted;
    }

    return ProposalStatus.Rejected;
  }

  isPending() {
    return this.status() === ProposalStatus.Pending;
  }

  isApproved() {
    return this.status() === ProposalStatus.Accepted;
  }
}