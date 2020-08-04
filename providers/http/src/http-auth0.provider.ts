import { injectable } from 'inversify';
import createAuth0Client, {Auth0Client} from '@auth0/auth0-spa-js';

import { EthereumConnection } from '@uprtcl/ethereum-provider';
import { Logger } from '@uprtcl/micro-orchestrator';

import { HttpConnection } from './http.connection';
import { HttpProvider, HttpProviderOptions } from './http.provider';

@injectable()
export class HttpAuth0Provider extends HttpProvider {
  logger = new Logger('HTTP-AUTH0-Provider');

  account: string | undefined = undefined;

  constructor(
    protected options: HttpProviderOptions,
    protected connection: HttpConnection,
    protected auth0: Auth0Client,
  ) {
    super(options, connection);
    
    // TODO: refactor
    this.auth0 = new Auth0Client({
      domain: 'linked-thoughts-dev.eu.auth0.com',
      client_id: 'I7cwQfbSOm9zzU29Lt0Z3TjQsdB6GVEf',
      redirect_uri: `${window.location.origin}/home`,
      cacheLocation: 'localstorage',
    });
      
  }

  async connect() {
    const currentUserId = this.connection.userId;

    if (currentUserId !== undefined) {
      try {
        const isAuthorized = await this.isLogged();
        if(isAuthorized) {
          const user = await this.auth0.getUser();
          
          if(currentUserId !== user.sub) {
            this.logout();
          }
        } else {
          this.logout();
        }
      } catch (e) {
        this.connection.userId = undefined;
      }
    }

    /** chech if HTTP authToken is available */
    const currentToken = this.connection.authToken;

    if (currentToken !== undefined) {
      try {
        /** if there is a token, check if the token is valid */
        const isAuthorized = await this.isLogged();
        if (!isAuthorized) this.logout();
      } catch (e) {
        this.connection.authToken = undefined;
      }
    }
  }

  async isLogged() {
    if (this.connection.userId === undefined) return false;
    return this.auth0.isAuthenticated();
  }

  async logout(): Promise<void> {

    try {
      this.auth0.logout({
        returnTo: window.location.origin
      });
    } catch (err) {
      console.log("Log out failed", err);
    }

    this.connection.userId = undefined;
    this.connection.authToken = undefined;
  }

  async parseLoginResult() {
    try {
      const result = await this.auth0.handleRedirectCallback();
      
      if (result.appState && result.appState.targetUrl) {
        const user = await this.auth0.getUser();
        const auth0Claims = await this.auth0.getIdTokenClaims(); 
        
        this.connection.userId = user.sub;
        this.connection.authToken = 'Bearer ' + auth0Claims.__raw;
        
        const url = window.location.origin + window.location.pathname

        window.history.replaceState({}, document.title, url);
      }

    } catch (err) {
      console.log("Error parsing redirect:", err);
    }
  }
  
  async makeLoginRedirect() {
    try {
      const url = window.location.origin + window.location.pathname;

      const options = {
        redirect_uri: url,
        appState: { targetUrl: url },
      };

      await this.auth0.loginWithRedirect(options);
    } catch (err) {
      console.log("Log in failed", err);
    }
  }

  async login(): Promise<void> {

    const query = window.location.search;
    const shouldParseResult = query.includes("code=") && query.includes("state=");

    if (shouldParseResult) {
      this.parseLoginResult();
    } else {
      this.makeLoginRedirect();
    }

  }
}
