"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Webview = exports.getLibraryPath = void 0;
const ffi_napi_1 = require("ffi-napi");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
/**
 * get lib path from node_modules and extract webview2loader in windows
 * @return the path to libwebview
*/
function getLibraryPath() {
    let dir = __dirname;
    let arch = process.arch;
    let platform = process.platform;
    let libName = 'libwebview' + ffi_napi_1.LIB_EXT;
    if (platform == 'win32') {
        libName = libName.replace(/^(lib)/, '');
        // Copy dlls
        let dst = path_1.default.join('.', 'WebView2Loader.dll');
        if (!fs_1.default.existsSync(dst)) {
            fs_1.default.copyFileSync(path_1.default.join(dir, 'libs', platform, arch, 'WebView2Loader.dll'), dst);
        }
    }
    if (['linux', 'win32', 'darwin'].includes(platform) && arch == 'x64') {
        return path_1.default.join(dir, 'libs', platform, arch, libName);
    }
    else {
        throw new ReferenceError("Unsupported pattform: " + platform + arch);
    }
}
exports.getLibraryPath = getLibraryPath;
class Webview {
    /**
     * Create a webview.
     *
     * @debug enable DevTools and other debug features.
     * @param libPath the path to lib(dll/so/dylib). If not set, it will use built in libs.
     */
    constructor(debug = false, libPath = getLibraryPath()) {
        this.WindowHint = {
            /** Width and height are default size */
            NONE: 0,
            /** Width and height are minimum bounds */
            MIN: 1,
            /** Width and height are maximum bounds */
            MAX: 2,
            /** Window size can not be changed by a user */
            FIXED: 3,
        };
        this.lib = new ffi_napi_1.Library(libPath, {
            'webview_create': ['pointer', ['int', 'pointer']],
            'webview_run': ['void', ['pointer']],
            'webview_terminate': ['void', ['pointer']],
            'webview_destroy': ['void', ['pointer']],
            'webview_set_title': ['void', ['pointer', 'string']],
            'webview_set_html': ['void', ['pointer', 'string']],
            'webview_navigate': ['void', ['pointer', 'string']],
            'webview_init': ['void', ['pointer', 'string']],
            'webview_eval': ['void', ['pointer', 'string']],
            'webview_dispatch': ['void', ['pointer', 'pointer']],
            'webview_bind': ['void', ['pointer', 'string', 'pointer', 'pointer']],
            'webview_return': ['void', ['pointer', 'string', 'int', 'string']],
            'webview_unbind': ['void', ['pointer', 'string']],
            'webview_set_size': ['void', ['pointer', 'int', 'int', 'int']],
        });
        this.webview = this.lib.webview_create(debug ? 1 : 0, null);
        console.assert(this.webview != null);
    }
    /**
     * Updates the title of the native window.
     *
     * Must be called from the UI thread.
     *
     * @param v the new title
     */
    title(v) {
        this.lib.webview_set_title(this.webview, v);
    }
    /**
     * Navigates webview to the given URL
     *
     * URL may be a data URI, i.e. "data:text/text,...". It is often ok not to url-encode it properly, webview will re-encode it for you. Same as [navigate]
     *
     * @param v the URL or URI
     * */
    navigate(url) {
        this.lib.webview_navigate(this.webview, url);
    }
    /**
     * Set webview HTML directly.
     *
     * @param v the HTML content
     */
    html(v) {
        this.lib.webview_set_html(this.webview, v);
    }
    /**
    * Updates the size of the native window.
    *
    * Accepts a WEBVIEW_HINT
    *
    * @param hints can be one of `NONE(=0)`, `MIN(=1)`, `MAX(=2)` or `FIXED(=3)`
    */
    size(width, height, hints) {
        this.lib.webview_set_size(this.webview, width, height, hints);
    }
    /**
    * Injects JS code at the initialization of the new page.
    *
    * Every time the webview will open a new page - this initialization code will be executed. It is guaranteed that code is executed before window.onload.
    *
    * @param js the JS code
    */
    init(js) {
        this.lib.webview_init(this.webview, js);
    }
    /**
     * Evaluates arbitrary JS code.
     *
     * Evaluation happens asynchronously, also the result of the expression is ignored. Use the `webview_bind` function if you want to receive notifications about the results of the evaluation.
     *
     * @param js the JS code
     */
    eval(js) {
        this.lib.webview_eval(this.webview, js);
    }
    /**
     * Binds a native Kotlin/Java callback so that it will appear under the given name as a global JS function.
     *
     * Callback receives a request string. Request string is a JSON array of all the arguments passed to the JS function.
     *
     * @param name the name of the global JS function
     * @param fn the callback function receives the request parameter in webview browser and return the response(=[isSuccess,result]), both in JSON string. If isSuccess=false, it wll reject the Promise.
     */
    bindRaw(name, fn) {
        let callback = (0, ffi_napi_1.Callback)('void', ['string', 'string', 'pointer'], (seq, req, _arg) => {
            const [isSuccess, result] = fn(this, req);
            this.lib.webview_return(this.webview, seq, isSuccess ? 0 : 1, result);
        });
        this.lib.webview_bind(this.webview, name, callback, null);
        process.on('exit', function () { callback; });
    }
    /**
    * Binds a Kotlin callback so that it will appear under the given name as a global JS function.
    *
    * @param name the name of the global browser JS function
    * @param fn the callback function which receives the parameter and return the result to Webview. Any exception happened in Node.js here will reject the `Promise` instead of crash the program.
    *
    * ### Example
    *
    * ```js
    * bind("sumInNodeJS",(arg0,arg1) => {
    *   return arg0+arg1;
    * });
    * ```
    * in Webview browser, you should call `await sumInNodeJS(1,2)` and get `3`
    */
    bind(name, fn) {
        this.bindRaw(name, (w, req) => {
            let args = JSON.parse(req);
            try {
                return [true, JSON.stringify(fn(w, ...args))];
            }
            catch (error) {
                return [false, JSON.stringify(error)];
            }
        });
    }
    /**
    * Posts a function to be executed on the main thread.
    *
    * It safely schedules the callback to be run on the main thread on the next main loop iteration.
    *
    * @param fn the function to be executed on the main thread.
    */
    dispatch(fn) {
        let callback = (0, ffi_napi_1.Callback)('void', ['pointer', 'pointer'], (_, arg) => {
            fn(this);
        });
        this.lib.webview_dispatch(this.webview, callback);
        process.on('exit', function () { callback; });
    }
    /**
     * Removes a callback that was previously set by `webview_bind`.
     *
     * @param name the name of JS function used in `webview_bind`
     */
    unbind(name) {
        this.lib.webview_unbind(this.webview, name);
    }
    /**
     * Runs the main loop and destroy it when terminated.
     *
     * This will block the thread.
     */
    show() {
        this.lib.webview_run(this.webview);
        this.lib.webview_destroy(this.webview);
    }
    /**
     * Stops the main loop.
     *
     * It is safe to call this function from another other background thread.
     */
    terminate() {
        this.lib.webview_terminate(this.webview);
    }
}
exports.Webview = Webview;