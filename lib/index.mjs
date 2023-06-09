import { createUnplugin } from 'unplugin';
import { normalize, parse } from 'pathe';
import createDebug from 'debug';
import fg from 'fast-glob';
import { isString, isArray, isBoolean, isObject, isNumber, isEmptyObject, assign, generateCodeFrame } from '@intlify/shared';
import { createFilter } from '@rollup/pluginutils';
import { checkInstallPackage, checkVueI18nBridgeInstallPackage, getVueI18nVersion, generateJSON, generateYAML, generateJavaScript } from '@intlify/bundle-utils';
import { parse as parse$1 } from '@vue/compiler-sfc';
import JSON5 from 'json5';
import yaml from 'js-yaml';
import { promises } from 'fs';
import pc from 'picocolors';

function parseVueRequest(id) {
  const [filename, rawQuery] = id.split(`?`, 2);
  const params = new URLSearchParams(rawQuery);
  const ret = {};
  const langPart = Object.keys(Object.fromEntries(params)).find(
    (key) => /lang\./i.test(key)
  );
  ret.vue = params.has("vue");
  ret.global = params.has("global");
  ret.src = params.has("src");
  ret.raw = params.has("raw");
  if (params.has("type")) {
    ret.type = params.get("type");
  }
  if (params.has("blockType")) {
    ret.blockType = params.get("blockType");
  }
  if (params.has("index")) {
    ret.index = Number(params.get("index"));
  }
  if (params.has("locale")) {
    ret.locale = params.get("locale");
  }
  if (langPart) {
    const [, lang] = langPart.split(".");
    ret.lang = lang;
  } else if (params.has("lang")) {
    ret.lang = params.get("lang");
  }
  if (params.has("issuerPath")) {
    ret.issuerPath = params.get("issuerPath");
  }
  return {
    filename,
    query: ret
  };
}

function createBridgeCodeGenerator(source, query) {
  return () => {
    const data = convert(source, query.lang);
    let value = JSON.parse(data);
    if (isString(query.locale)) {
      value = Object.assign({}, { [query.locale]: value });
    }
    return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029").replace(/\\/g, "\\\\").replace(/\u0027/g, "\\u0027");
  };
}
function convert(source, lang) {
  switch (lang) {
    case "yaml":
    case "yml":
      const data = yaml.load(source);
      return JSON.stringify(data, void 0, "	");
    case "json5":
      return JSON.stringify(JSON5.parse(source));
    default:
      return source;
  }
}

function warn(...args) {
  console.warn(pc.yellow(pc.bold(`[unplugin-vue-i18n] `)), ...args);
}
function error(...args) {
  console.error(pc.red(pc.bold(`[unplugin-vue-i18n] `)), ...args);
}
async function getRaw(path) {
  return promises.readFile(path, { encoding: "utf-8" });
}
function raiseError(message) {
  throw new Error(`[unplugin-vue-i18n] ${message}`);
}

const INTLIFY_BUNDLE_IMPORT_ID = "@intlify/unplugin-vue-i18n/messages";
const INTLIFY_BUNDLE_IMPORT_DEPRECTED_ID = "@intlify/vite-plugin-vue-i18n/messages";
const VIRTUAL_PREFIX = "\0";
const debug = createDebug("unplugin-vue-i18n");
const installedPkg = checkInstallPackage("@intlify/unplugin-vue-i18n", debug);
const installedVueI18nBridge = checkVueI18nBridgeInstallPackage(debug);
const vueI18nVersion = getVueI18nVersion(debug);
const unplugin = createUnplugin((options = {}, meta) => {
  debug("plugin options:", options, meta.framework);
  if (!["vite", "webpack"].includes(meta.framework)) {
    raiseError(`This plugin is supported 'vite' and 'webpack' only`);
  }
  let include = options.include;
  let exclude = null;
  if (include) {
    if (isArray(include)) {
      include = include.map((item) => normalize(item));
    } else if (isString(include)) {
      include = normalize(include);
    }
  } else {
    exclude = "**/**";
  }
  const filter = createFilter(include, exclude);
  const forceStringify = !!options.forceStringify;
  const defaultSFCLang = isString(options.defaultSFCLang) ? options.defaultSFCLang : "json";
  const globalSFCScope = !!options.globalSFCScope;
  const useClassComponent = !!options.useClassComponent;
  const bridge = !!options.bridge;
  debug("bridge", bridge);
  const runtimeOnly = isBoolean(options.runtimeOnly) ? options.runtimeOnly : true;
  debug("runtimeOnly", runtimeOnly);
  const compositionOnly = installedPkg === "vue-i18n" ? isBoolean(options.compositionOnly) ? options.compositionOnly : true : true;
  debug("compositionOnly", compositionOnly);
  const fullInstall = installedPkg === "vue-i18n" ? isBoolean(options.fullInstall) ? options.fullInstall : true : false;
  debug("fullInstall", fullInstall);
  const useVueI18nImportName = options.useVueI18nImportName;
  if (useVueI18nImportName != null) {
    warn(`'useVueI18nImportName' option is experimental`);
  }
  debug("useVueI18nImportName", useVueI18nImportName);
  const getVueI18nAliasName = () => vueI18nVersion === "9" || vueI18nVersion === "8" ? "vue-i18n" : vueI18nVersion === "unknown" && installedPkg === "petite-vue-i18n" && isBoolean(useVueI18nImportName) && useVueI18nImportName ? "vue-i18n" : installedPkg;
  const getVueI18nBridgeAliasPath = () => `vue-i18n-bridge/dist/vue-i18n-bridge.runtime.esm-bundler.js`;
  const getVueI18nAliasPath = (aliasName) => vueI18nVersion === "8" ? `${aliasName}/dist/${aliasName}.esm.js` : `${aliasName}/dist/${installedPkg}.runtime.esm-bundler.js`;
  const esm = isBoolean(options.esm) ? options.esm : true;
  debug("esm", esm);
  const allowDynamic = !!options.allowDynamic;
  debug("allowDynamic", allowDynamic);
  const strictMessage = isBoolean(options.strictMessage) ? options.strictMessage : true;
  debug("strictMessage", strictMessage);
  const escapeHtml = !!options.escapeHtml;
  debug("escapeHtml", escapeHtml);
  let isProduction = false;
  let sourceMap = false;
  const vueI18nAliasName = getVueI18nAliasName();
  return {
    name: "unplugin-vue-i18n",
    /**
     * NOTE:
     *
     * For vite, If we have json (including SFC's custom block),
     * transform it first because it will be transformed into javascript code by `vite:json` plugin.
     *
     * For webpack, This plugin will handle with ‘post’, because vue-loader generate the request query.
     */
    enforce: meta.framework === "vite" ? "pre" : "post",
    vite: {
      config(config, { command }) {
        config.resolve = normalizeConfigResolveAlias(
          config.resolve,
          meta.framework
        );
        if (command === "build" && runtimeOnly) {
          debug(`vue-i18n alias name: ${vueI18nAliasName}`);
          if (isArray(config.resolve.alias)) {
            config.resolve.alias.push({
              find: vueI18nAliasName,
              replacement: getVueI18nAliasPath(vueI18nAliasName)
            });
            if (installedVueI18nBridge) {
              config.resolve.alias.push({
                find: "vue-i18n-bridge",
                replacement: getVueI18nBridgeAliasPath()
              });
            }
          } else if (isObject(config.resolve.alias)) {
            config.resolve.alias[vueI18nAliasName] = getVueI18nAliasPath(vueI18nAliasName);
            if (installedVueI18nBridge) {
              config.resolve.alias["vue-i18n-bridge"] = getVueI18nBridgeAliasPath();
            }
          }
          debug(
            `set ${vueI18nAliasName} runtime only: ${getVueI18nAliasPath(
              vueI18nAliasName
            )}`
          );
          if (installedVueI18nBridge) {
            debug(
              `set vue-i18n-bridge runtime only: ${getVueI18nBridgeAliasPath()}`
            );
          }
        } else if (command === "serve" && installedPkg === "petite-vue-i18n" && useVueI18nImportName) {
          config.resolve = normalizeConfigResolveAlias(
            config.resolve,
            meta.framework
          );
          if (isArray(config.resolve.alias)) {
            config.resolve.alias.push({
              find: vueI18nAliasName,
              replacement: `petite-vue-i18n/dist/petite-vue-i18n.esm-bundler.js`
            });
          } else {
            config.resolve.alias[vueI18nAliasName] = `petite-vue-i18n/dist/petite-vue-i18n.esm-bundler.js`;
          }
          debug(`petite-vue-i18n alias name: ${vueI18nAliasName}`);
        }
        config.define = config.define || {};
        config.define["__VUE_I18N_LEGACY_API__"] = !compositionOnly;
        debug(
          `set __VUE_I18N_LEGACY_API__ is '${config.define["__VUE_I18N_LEGACY_API__"]}'`
        );
        config.define["__VUE_I18N_FULL_INSTALL__"] = fullInstall;
        debug(
          `set __VUE_I18N_FULL_INSTALL__ is '${config.define["__VUE_I18N_FULL_INSTALL__"]}'`
        );
        config.define["__VUE_I18N_PROD_DEVTOOLS__"] = false;
      },
      configResolved(config) {
        isProduction = config.isProduction;
        sourceMap = config.command === "build" ? !!config.build.sourcemap : false;
        debug(
          `configResolved: isProduction = ${isProduction}, sourceMap = ${sourceMap}`
        );
        const jsonPlugin = config.plugins.find((p) => p.name === "vite:json");
        if (jsonPlugin) {
          const orgTransform = jsonPlugin.transform;
          jsonPlugin.transform = async function(code, id) {
            if (!/\.json$/.test(id) || filter(id)) {
              return;
            }
            const { query } = parseVueRequest(id);
            if (query.vue) {
              return;
            }
            debug("org json plugin");
            return orgTransform.apply(this, [code, id]);
          };
        }
        const esbuildPlugin = config.plugins.find(
          (p) => p.name === "vite:esbuild"
        );
        if (esbuildPlugin) {
          const orgTransform = esbuildPlugin.transform;
          esbuildPlugin.transform = async function(code, id) {
            const result = await orgTransform.apply(this, [
              code,
              id
            ]);
            if (result == null) {
              return result;
            }
            const { filename, query } = parseVueRequest(id);
            if (!query.vue && filter(id) && /\.[c|m]?ts$/.test(id)) {
              const [_code, inSourceMap] = isString(result) ? [result, void 0] : [result.code, result.map];
              let langInfo = defaultSFCLang;
              langInfo = parse(filename).ext;
              const generate = getGenerator(langInfo);
              const parseOptions = getOptions(
                filename,
                isProduction,
                query,
                sourceMap,
                {
                  inSourceMap,
                  isGlobal: globalSFCScope,
                  useClassComponent,
                  allowDynamic,
                  strictMessage,
                  escapeHtml,
                  bridge,
                  exportESM: esm,
                  forceStringify
                }
              );
              debug("parseOptions", parseOptions);
              const { code: generatedCode, map } = generate(
                _code,
                parseOptions,
                bridge ? createBridgeCodeGenerator(_code, query) : void 0
              );
              debug("generated code", generatedCode);
              debug("sourcemap", map, sourceMap);
              if (_code === generatedCode)
                return;
              return {
                code: generatedCode,
                map: sourceMap ? map : { mappings: "" }
                // eslint-disable-line @typescript-eslint/no-explicit-any
              };
            } else {
              return result;
            }
          };
        }
      },
      async handleHotUpdate({ file, server }) {
        if (/\.(json5?|ya?ml)$/.test(file)) {
          const module = server.moduleGraph.getModuleById(
            asVirtualId(INTLIFY_BUNDLE_IMPORT_ID, meta.framework)
          );
          if (module) {
            server.moduleGraph.invalidateModule(module);
            return [module];
          }
        }
      }
    },
    webpack(compiler) {
      isProduction = compiler.options.mode !== "development";
      sourceMap = !!compiler.options.devtool;
      debug(`webpack: isProduction = ${isProduction}, sourceMap = ${sourceMap}`);
      compiler.options.resolve = normalizeConfigResolveAlias(
        compiler.options.resolve,
        meta.framework
      );
      if (isProduction && runtimeOnly) {
        compiler.options.resolve.alias[vueI18nAliasName] = getVueI18nAliasPath(vueI18nAliasName);
        if (installedVueI18nBridge) {
          compiler.options.resolve.alias["vue-i18n-bridge"] = getVueI18nBridgeAliasPath();
        }
        debug(
          `set ${vueI18nAliasName} runtime only: ${getVueI18nAliasPath(
            vueI18nAliasName
          )}`
        );
        if (installedVueI18nBridge) {
          debug(
            `set vue-i18n-bridge runtime only: ${getVueI18nBridgeAliasPath()}`
          );
        }
      } else if (!isProduction && installedPkg === "petite-vue-i18n" && useVueI18nImportName) {
        compiler.options.resolve.alias[vueI18nAliasName] = `petite-vue-i18n/dist/petite-vue-i18n.esm-bundler.js`;
        debug(`petite-vue-i18n alias name: ${vueI18nAliasName}`);
      }
      loadWebpack().then((webpack) => {
        if (webpack) {
          compiler.options.plugins.push(
            new webpack.DefinePlugin({
              __VUE_I18N_LEGACY_API__: JSON.stringify(compositionOnly),
              __VUE_I18N_FULL_INSTALL__: JSON.stringify(fullInstall),
              __INTLIFY_PROD_DEVTOOLS__: "false"
            })
          );
          debug(`set __VUE_I18N_LEGACY_API__ is '${compositionOnly}'`);
          debug(`set __VUE_I18N_FULL_INSTALL__ is '${fullInstall}'`);
        } else {
          debug("ignore vue-i18n feature flags with webpack.DefinePlugin");
        }
      });
      if (compiler.options.module) {
        compiler.options.module.rules.push({
          test: /\.(json5?|ya?ml)$/,
          type: "javascript/auto",
          include(resource) {
            return filter(resource);
          }
        });
      }
    },
    resolveId(id, importer) {
      debug("resolveId", id, importer);
      if (id === INTLIFY_BUNDLE_IMPORT_DEPRECTED_ID) {
        warn(
          `deprected '${INTLIFY_BUNDLE_IMPORT_DEPRECTED_ID}', you should switch to '${INTLIFY_BUNDLE_IMPORT_ID}'`
        );
        return asVirtualId(id, meta.framework);
      }
      if (id === INTLIFY_BUNDLE_IMPORT_ID) {
        return asVirtualId(id, meta.framework);
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async load(id) {
      debug("load", id);
      const { query } = parseVueRequest(id);
      if ([INTLIFY_BUNDLE_IMPORT_DEPRECTED_ID, INTLIFY_BUNDLE_IMPORT_ID].includes(
        getVirtualId(id, meta.framework)
      ) && include) {
        let resourcePaths = [];
        const includePaths = isArray(include) ? include : [include];
        for (const inc of includePaths) {
          resourcePaths = [...resourcePaths, ...await fg(inc)];
        }
        resourcePaths = resourcePaths.filter(
          (el, pos) => resourcePaths.indexOf(el) === pos
        );
        const code = await generateBundleResources(
          resourcePaths,
          query,
          isProduction,
          {
            forceStringify,
            bridge,
            strictMessage,
            escapeHtml,
            exportESM: esm,
            useClassComponent
          }
        );
        return {
          code,
          map: { mappings: "" }
        };
      }
    },
    transformInclude(id) {
      debug("transformInclude", id);
      if (meta.framework === "vite") {
        return true;
      } else {
        const { filename } = parseVueRequest(id);
        return filename.endsWith("vue") || filename.endsWith(INTLIFY_BUNDLE_IMPORT_ID) || filename.endsWith(INTLIFY_BUNDLE_IMPORT_DEPRECTED_ID) || /\.(json5?|ya?ml)$/.test(filename) && filter(filename);
      }
    },
    async transform(code, id) {
      const { filename, query } = parseVueRequest(id);
      debug("transform", id, JSON.stringify(query), filename);
      let langInfo = defaultSFCLang;
      let inSourceMap;
      if (!query.vue) {
        if (/\.(json5?|ya?ml|[c|m]?js)$/.test(id) && filter(id)) {
          langInfo = parse(filename).ext;
          const generate = getGenerator(langInfo);
          const parseOptions = getOptions(
            filename,
            isProduction,
            query,
            sourceMap,
            {
              inSourceMap,
              isGlobal: globalSFCScope,
              useClassComponent,
              allowDynamic,
              strictMessage,
              escapeHtml,
              bridge,
              exportESM: esm,
              forceStringify
            }
          );
          debug("parseOptions", parseOptions);
          const { code: generatedCode, map } = generate(
            code,
            parseOptions,
            bridge ? createBridgeCodeGenerator(code, query) : void 0
          );
          debug("generated code", generatedCode);
          debug("sourcemap", map, sourceMap);
          if (code === generatedCode)
            return;
          return {
            code: generatedCode,
            map: sourceMap ? map : { mappings: "" }
            // eslint-disable-line @typescript-eslint/no-explicit-any
          };
        }
      } else {
        if (isCustomBlock(query)) {
          if (isString(query.lang)) {
            langInfo = query.src ? query.lang === "i18n" ? "json" : query.lang : query.lang;
          } else if (defaultSFCLang) {
            langInfo = defaultSFCLang;
          }
          debug("langInfo", langInfo);
          const generate = /\.?json5?/.test(langInfo) ? generateJSON : generateYAML;
          const parseOptions = getOptions(
            filename,
            isProduction,
            query,
            sourceMap,
            {
              inSourceMap,
              isGlobal: globalSFCScope,
              useClassComponent,
              bridge,
              strictMessage,
              escapeHtml,
              exportESM: esm,
              forceStringify
            }
          );
          debug("parseOptions", parseOptions);
          const source = await getCode(
            code,
            filename,
            sourceMap,
            query,
            meta.framework
          );
          const { code: generatedCode, map } = generate(
            source,
            parseOptions,
            bridge ? createBridgeCodeGenerator(source, query) : void 0
          );
          debug("generated code", generatedCode);
          debug("sourcemap", map, sourceMap);
          if (code === generatedCode)
            return;
          return {
            code: generatedCode,
            map: sourceMap ? map : { mappings: "" }
            // eslint-disable-line @typescript-eslint/no-explicit-any
          };
        }
      }
    }
  };
});
function getGenerator(ext, defaultGen = generateJSON) {
  return /\.?json5?$/.test(ext) ? generateJSON : /\.ya?ml$/.test(ext) ? generateYAML : /\.([c|m]?js|[c|m]?ts)$/.test(ext) ? generateJavaScript : defaultGen;
}
function normalizeConfigResolveAlias(resolve, framework) {
  if (resolve && resolve.alias) {
    return resolve;
  }
  if (!resolve) {
    if (framework === "vite") {
      return { alias: [] };
    } else if (framework === "webpack") {
      return { alias: {} };
    }
  } else if (!resolve.alias) {
    if (framework === "vite") {
      resolve.alias = [];
      return resolve;
    } else if (framework === "webpack") {
      resolve.alias = {};
      return resolve;
    }
  }
}
async function loadWebpack() {
  let webpack = null;
  try {
    webpack = await import('webpack').then((m) => m.default || m);
  } catch (e) {
    warn(`webpack not found, please install webpack.`);
  }
  return webpack;
}
async function generateBundleResources(resources, query, isProduction, {
  forceStringify = false,
  isGlobal = false,
  bridge = false,
  exportESM = true,
  strictMessage = true,
  escapeHtml = false,
  useClassComponent = false
}) {
  const codes = [];
  for (const res of resources) {
    debug(`${res} bundle loading ...`);
    if (/\.(json5?|ya?ml)$/.test(res)) {
      const { ext, name } = parse(res);
      const source = await getRaw(res);
      const generate = /json5?/.test(ext) ? generateJSON : generateYAML;
      const parseOptions = getOptions(res, isProduction, {}, false, {
        isGlobal,
        useClassComponent,
        bridge,
        exportESM,
        strictMessage,
        escapeHtml,
        forceStringify
      });
      parseOptions.type = "bare";
      const { code } = generate(
        source,
        parseOptions,
        bridge ? createBridgeCodeGenerator(source, query) : void 0
      );
      debug("generated code", code);
      codes.push(`${JSON.stringify(name)}: ${code}`);
    }
  }
  return `export default {
  ${codes.join(`,
`)}
}`;
}
async function getCode(source, filename, sourceMap, query, framework = "vite") {
  const { index, issuerPath } = query;
  if (!isNumber(index)) {
    raiseError(`unexpected index: ${index}`);
  }
  if (framework === "webpack") {
    if (issuerPath) {
      debug(`getCode (webpack) ${index} via issuerPath`, issuerPath);
      return await getRaw(filename);
    } else {
      const result = parse$1(await getRaw(filename), {
        sourceMap,
        filename
      });
      const block = result.descriptor.customBlocks[index];
      if (block) {
        const code = block.src ? await getRaw(block.src) : block.content;
        debug(`getCode (webpack) ${index} from SFC`, code);
        return code;
      } else {
        return source;
      }
    }
  } else {
    return source;
  }
}
function isCustomBlock(query) {
  return !isEmptyObject(query) && "vue" in query && (query["type"] === "custom" || // for vite (@vite-plugin-vue)
  query["type"] === "i18n" || // for webpack (vue-loader)
  query["blockType"] === "i18n");
}
function getOptions(filename, isProduction, query, sourceMap, {
  inSourceMap = void 0,
  forceStringify = false,
  isGlobal = false,
  bridge = false,
  exportESM = true,
  useClassComponent = false,
  allowDynamic = false,
  strictMessage = true,
  escapeHtml = false
}) {
  const mode = isProduction ? "production" : "development";
  const baseOptions = {
    filename,
    sourceMap,
    inSourceMap,
    forceStringify,
    useClassComponent,
    allowDynamic,
    strictMessage,
    escapeHtml,
    bridge,
    exportESM,
    env: mode,
    onWarn: (msg) => {
      warn(`${filename} ${msg}`);
    },
    onError: (msg, extra) => {
      const codeFrame = generateCodeFrame(
        extra?.source || extra?.location?.source || "",
        extra?.location?.start.column,
        extra?.location?.end.column
      );
      const errMssage = `${msg} (error code: ${extra?.code}) in ${filename}
  target message: ${extra?.source}
  target message path: ${extra?.path}

  ${codeFrame}
`;
      error(errMssage);
      throw new Error(errMssage);
    }
  };
  if (isCustomBlock(query)) {
    return assign(baseOptions, {
      type: "sfc",
      locale: isString(query.locale) ? query.locale : "",
      isGlobal: isGlobal || !!query.global
    });
  } else {
    return assign(baseOptions, {
      type: "plain",
      isGlobal: false
    });
  }
}
function getVirtualId(id, framework = "vite") {
  return framework === "vite" ? id.startsWith(VIRTUAL_PREFIX) ? id.slice(VIRTUAL_PREFIX.length) : "" : id;
}
function asVirtualId(id, framework = "vite") {
  return framework === "vite" ? VIRTUAL_PREFIX + id : id;
}

export { unplugin as default, unplugin };
