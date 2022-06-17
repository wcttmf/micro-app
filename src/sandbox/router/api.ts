import type {
  Func,
  Router,
  RouterTarget,
  navigationMethod,
  MicroLocation,
  RouterGuard,
  GuardLocation,
  AccurateGuard,
} from '@micro-app/types'
import {
  encodeMicroPath,
  decodeMicroPath,
  setMicroPathToURL, setMicroState, getMicroPathFromURL
} from './core'
import {
  logError,
  formatAppName,
  createURL,
  isFunction,
  isPlainObject,
  useCallbacks,
  requestIdleCallback,
  isString,
} from '../../libs/utils'
import { appInstanceMap } from '../../create_app'
import { getActiveApps } from '../../micro_app'
import { dispatchPopStateEventToMicroApp } from './event'
import globalEnv from '../../libs/global_env'

import { nativeHistoryNavigate } from './history'

export interface RouterApi {
  router: Router,
  executeNavigationGuard: (appName: string, to: GuardLocation, from: GuardLocation) => void
  clearCurrentWhenUnmount: (appName: string) => void
}

function createRouterApi (): RouterApi {
  /**
   * create method of router.push/replace
   * NOTE:
   * 1. The same fullPath will be blocked
   * 2. name & path is required
   * 3. path is fullPath except for the domain (the domain can be taken, but not valid)
   * @param replace use router.replace?
   */
  function createNavigationMethod (replace: boolean): navigationMethod {
    return function (to: RouterTarget): void {
      const appName = formatAppName(to.name)
      if (appName && isString(to.path)) {
        const app = appInstanceMap.get(appName)
        if (app && !app.sandBox) return logError(`navigation failed, sandBox of app ${appName} is closed`)
        // active apps, include hidden keep-alive
        if (getActiveApps().includes(appName)) {
          const proxyWindow = app!.sandBox!.proxyWindow
          const microLocation = proxyWindow.location
          const currentFullPath = microLocation.pathname + microLocation.search + microLocation.hash
          const targetLocation = createURL(to.path, app!.url)
          // Only get path data, even if the origin is different from microApp
          const targetPath = targetLocation.pathname + targetLocation.search + targetLocation.hash
          if (currentFullPath !== targetPath) {
            const methodName = (replace && to.replace !== false) || to.replace === true ? 'replaceState' : 'pushState'
            proxyWindow.history[methodName](to.state ?? null, '', targetPath)
            dispatchPopStateEventToMicroApp(appName, proxyWindow, null)
          }
        } else {
          /**
           * app not exit or unmounted, update browser URL with replaceState
           *
           * use base app location.origin as baseURL
           */
          const targetLocation = createURL(to.path, location.origin)
          const targetPath = targetLocation.pathname + targetLocation.search + targetLocation.hash
          if (getMicroPathFromURL(appName) !== targetPath) {
            const setMicroPathResult = setMicroPathToURL(appName, targetLocation)
            nativeHistoryNavigate(
              to.replace === false ? 'pushState' : 'replaceState',
              setMicroPathResult.fullPath,
              setMicroState(
                appName,
                globalEnv.rawWindow.history.state,
                to.state ?? null,
                location.origin,
                setMicroPathResult.searchHash,
              ),
            )
          }
        }
      } else {
        logError(`navigation failed, name & path are required when use router.${replace ? 'replace' : 'push'}`)
      }
    }
  }

  // create method of router.go/back/forward
  function createRawHistoryMethod (methodName: string): Func {
    return function (...rests: unknown[]): void {
      return globalEnv.rawWindow.history[methodName](...rests)
    }
  }

  const beforeGuards = useCallbacks<RouterGuard>()
  const afterGuards = useCallbacks<RouterGuard>()

  /**
   * run all of beforeEach/afterEach guards
   * @param appName app name
   * @param to target location
   * @param from old location
   * @param guards guards list
   */
  function runGuards (
    appName: string,
    to: GuardLocation,
    from: GuardLocation,
    guards: Set<RouterGuard>,
  ) {
    for (const guard of guards) {
      if (isFunction(guard)) {
        guard(appName, to, from)
      } else if (isPlainObject(guard) && isFunction((guard as AccurateGuard)[appName])) {
        guard[appName](to, from)
      }
    }
  }

  /**
   * global hook for router
   * update router information base on microLocation
   * @param appName app name
   * @param microLocation location of microApp
   */
  function executeNavigationGuard (
    appName: string,
    to: GuardLocation,
    from: GuardLocation,
  ): void {
    router.current.set(appName, to)

    runGuards(appName, to, from, beforeGuards.list())

    requestIdleCallback(() => {
      runGuards(appName, to, from, afterGuards.list())
    })
  }

  function clearCurrentWhenUnmount (appName: string): void {
    router.current.delete(appName)
  }

  // Router API for developer
  const router: Router = {
    current: new Map<string, MicroLocation>(),
    encode: encodeMicroPath,
    decode: decodeMicroPath,
    push: createNavigationMethod(false),
    replace: createNavigationMethod(true),
    go: createRawHistoryMethod('go'),
    back: createRawHistoryMethod('back'),
    forward: createRawHistoryMethod('forward'),
    beforeEach: beforeGuards.add,
    afterEach: afterGuards.add,
    // attachToURL: 将指定的子应用路由信息添加到浏览器地址上
    // attachAllToURL: 将所有正在运行的子应用路由信息添加到浏览器地址上
    // defaultPage / defaultPath  defaultPage吧，更鲜明，defaultPath感觉和之前的baseRoute差不多
  }

  return { router, executeNavigationGuard, clearCurrentWhenUnmount }
}

export const { router, executeNavigationGuard, clearCurrentWhenUnmount } = createRouterApi()
