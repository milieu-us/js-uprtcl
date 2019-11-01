import {
  Store,
  createStore,
  compose,
  combineReducers,
  applyMiddleware,
  AnyAction,
  StoreEnhancer
} from 'redux';
import { LazyStore, lazyReducerEnhancer } from 'pwa-helpers/lazy-reducer-enhancer.js';
import thunk, { ThunkMiddleware } from 'redux-thunk';
import { injectable, interfaces } from 'inversify';

import { MicroModule } from '../micro.module';
import { ReduxTypes } from '../../types';

@injectable()
export class ReduxStoreModule implements MicroModule {
  async onLoad(
    context: interfaces.Context,
    bind: interfaces.Bind,
    unbind: interfaces.Unbind,
    isBound: interfaces.IsBound,
    rebind: interfaces.Rebind
  ): Promise<void> {
    if (isBound(ReduxTypes.Store)) return;

    const devCompose: <Ext0, Ext1, StateExt0, StateExt1>(
      f1: StoreEnhancer<Ext0, StateExt0>,
      f2: StoreEnhancer<Ext1, StateExt1>
    ) => StoreEnhancer<Ext0 & Ext1, StateExt0 & StateExt1> =
      window['__REDUX_DEVTOOLS_EXTENSION_COMPOSE__'] || compose;

    const store = createStore(
      (state, action) => state,
      devCompose(
        lazyReducerEnhancer(combineReducers),
        // TODO: add dynamic middlewares
        applyMiddleware(thunk as ThunkMiddleware<any, AnyAction>)
      )
    ) as Store & LazyStore;

    bind<Store & LazyStore>(ReduxTypes.Store).toConstantValue(store);
  }

  async onUnload(): Promise<void> {}
}