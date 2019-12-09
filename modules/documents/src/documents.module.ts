import { injectable } from 'inversify';

import { ReduxCortexModule, graphQlSchemaModule } from '@uprtcl/common';

import { TextNodeLens } from './lenses/text-node.lens';
import {
  TextNodeActions,
  TextNodeCreate,
  TextNodePatterns,
  TextNodeEntity
} from './patterns/text-node.entity';
import { DocumentsTypes } from './types';
import { DocumentsProvider } from './services/documents.provider';
import { DocumentsLocal } from './services/documents.local';
import { Documents } from './services/documents';
import { DocumentsRemote } from './services/documents.remote';
import { documentsTypeDefs, documentsSchema } from './graphql';

/**
 * Configure a documents module with the given providers
 *
 * Depends on: lensesModule, PatternsModule, discoveryModule
 *
 * Example usage:
 *
 * ```ts
 * import { IpfsConnection } from '@uprtcl/connections';
 * import { documentsModule, DocumentsTypes, DocumentsIpfs } from '@uprtcl/documents';
 *
 * const ipfsConnection = new IpfsConnection({
 *   host: 'ipfs.infura.io',
 *   port: 5001,
 *   protocol: 'https'
 * });
 *
 *  const documentsProvider = new DocumentsIpfs(ipfsConnection);
 *
 * const docs = documentsModule([{ service: documentsProvider }]);
 * await orchestrator.loadModules({
 *   id: DocumentsTypes.Module,
 *   module: docs
 * });
 * ```
 *
 * @category CortexModule
 *
 * @param documentsRemote an array of remotes of documents
 * @param documentsLocal the local cache service to
 * @returns a configured documents module ready to be loaded
 */
export function documentsModule(
  documentsRemotes: DocumentsRemote[],
  documentsLocal: new (...args: any[]) => DocumentsProvider = DocumentsLocal
): new (...args: any[]) => ReduxCortexModule {
  @injectable()
  class DocumentsModule extends ReduxCortexModule {
    get sources() {
      return documentsRemotes.map(remote => ({
        symbol: DocumentsTypes.DocumentsRemote,
        source: remote
      }));
    }

    get services() {
      return [
        { symbol: DocumentsTypes.DocumentsLocal, service: documentsLocal },
        { symbol: DocumentsTypes.Documents, service: Documents }
      ];
    }

    get elements() {
      return [{ name: 'text-node', element: TextNodeLens }];
    }

    get patterns() {
      return [
        {
          symbol: DocumentsTypes.TextNodeEntity,
          patterns: [
            TextNodeEntity,
            TextNodeActions,
            TextNodeCreate,
            TextNodePatterns
          ]
        }
      ];
    }

    submodules = [graphQlSchemaModule(documentsTypeDefs, {})];
  }

  return DocumentsModule;
}
