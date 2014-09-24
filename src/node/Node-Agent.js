/*
 * Copyright (c) 2012 Massachusetts Institute of Technology, Adobe Systems
 * Incorporated, and other contributors. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global require, exports */

/**
 * Your connection to instrumented node code.
 *
 * Provides these events:
 *
 *   - receivedScriptInfo (path):
 *       when information about functions and call sites has been received
 *   - scriptWentAway (path):
 *       when the connection to the instance for a particular path has closed
 */

(function () {
    var _               = require("lodash");
    var EventEmitter    = require("events").EventEmitter;
    var WebSocket       = require("ws");

    /**
     * Replacement for $.Deferred. Bare minimum for any promise implementation. 
     */
    function Deferred () {
        this.doneCallbacks = [];
        this.doneArguments = []; 
        this.failCallbacks = [];
        this.failArguments = [];

        this.isResolved = false;
        this.isRejected = false;
    }

    Deferred.prototype = {
        promise: function () {
            return this;
        }, 

        resolve: function () {
            this.isResolved = true;

            this.doneArguments = Array.prototype.slice.apply(arguments);

            for (var i = 0; i < this.doneCallbacks.length; i++) {
                var cb = this.doneCallbacks[i]; 
                cb.apply(null, this.doneArguments);
            }
        },

        reject: function () {
            this.isRejected = true; 

            this.failArguments = Array.prototype.slice.apply(arguments);

            for (var i = 0; i < this.failCallbacks.length; i++) {
                var cb = this.failCallbacks[i]; 
                cb.apply(null, this.failArguments);
            }
        },

        done: function (cb) {
            if (this.isResolved) {
                cb.apply(null, this.doneArguments);
            } else {
                this.doneCallbacks.push(cb);
            }
            return this;
        },

        fail: function (cb) {
            if (this.isRejected) {
                cb.apply(null, this.failArguments);
            } else {
                this.failCallbacks.push(cb);
            }
            return this;
        }
    };

    function Connection(port) {
        this.socket = new WebSocket("ws://localhost:" + port + "/");
        this.socket.onerror = this._onerror.bind(this);
        this.socket.onopen = this._onopen.bind(this);
        this.socket.onmessage = this._onmessage.bind(this);
        this.socket.onclose = this._onclose.bind(this);
        this.connected = new Deferred();
        this.disconnected = new Deferred();
        this._nextRequestIndex = 0;
        this._requests = {};
    }
    Connection.prototype = {
        _onerror: function () {
            this.connected.reject();
            this.disconnected.resolve();
            this._rejectAllPending();
        },
        _onopen: function () {
            this.connected.resolve();
        },
        _onmessage: function (msg) {
            var resp;
            try {
                resp = JSON.parse(msg.data);
            } catch (e) {
                return;
            }

            if (resp.id in this._requests) {
                if ("data" in resp) {
                    this._requests[resp.id].resolve(resp.data);
                } else {
                    this._requests[resp.id].reject();
                }
                delete this._requests[resp.id];
            }
        },
        _onclose: function () {
            this.connected.reject();
            this.disconnected.resolve();
            this._rejectAllPending();
        },
        _rejectAllPending: function () {
            for (var i in this._requests) {
                this._requests[i].reject();
            }
            this._requests = {};
        },
        request: function (name, args) {
            var deferred = new Deferred();
            var idx = this._nextRequestIndex++;
            this.socket.send(JSON.stringify({
                name: name,
                arguments: args || [],
                id: idx
            }));
            this._requests[idx] = deferred;
            return deferred.promise();
        },
        disconnect: function () {
            this.disconnected.resolve();
            this.socket.close();
        }
    };

    function Agent () {
        _.bindAll(this);
    }

    Agent.prototype = Object.create(EventEmitter.prototype);
    Agent.prototype.constructor = Agent; 
    Agent.prototype.parentClass = EventEmitter.prototype;

    Agent.prototype._conn = undefined;    
    Agent.prototype._connected = false;
    Agent.prototype._nodes = {}; // id (string) -> {id: string, path: string, start: {line, column}, end: {line, column}, name: string (optional)}
    Agent.prototype._nodesByFilePath = {};
    Agent.prototype._hitsHandle = undefined; 
    Agent.prototype._exceptionsHandle = undefined;
    Agent.prototype._nodeHitCounts = {};
    Agent.prototype._nodeExceptionCounts = {};

    Agent.prototype._addNodes = function (nodes) {
        var indexByPath = function (obj, path, hash) {
            if (path in hash) {
                hash[path].push(obj);
            } else {
                hash[path] = [obj];
            }
        };

        for (var i in nodes) {
            var n = nodes[i];
            n.path = n.path.replace(/\\/g, "/"); // XXX: "Windows support"
            this._nodes[n.id] = n;
            indexByPath(n, n.path, this._nodesByFilePath);
        }

        // de-dup paths, then send receivedScriptInfo event for each one
        var pathsO = {};
        for (i in nodes) { pathsO[nodes[i].path] = true; }
        this.emit("receivedScriptInfo", _.keys(pathsO));
    };

    Agent.prototype._invoke = function (name, args, callback) {
        this._conn.connected.done(function () {
            this._conn.request(name, args).done(function (value) {
                if (callback !== undefined) {
                    callback(value);
                }
            });
        }.bind(this));
    };

    Agent.prototype._invokePromise = function (name, args) {
        return this._conn.connected.pipe(function () {
            return this._conn.request(name, args);
        });
    };

    Agent.prototype._reset = function () {
        this._nodes = {};
        this._nodesByFilePath = {};
        this._hitsHandle = undefined;
        this._exceptionsHandle = undefined;
        this._nodeHitCounts = {};
        this._nodeExceptionCounts = {};
    };

    Agent.prototype._connect = function (port) {
        this._conn = new Connection(port);

        this._conn.connected.done(this._onConnect);

        this._conn.disconnected.done(function () {
            if (this._connected) this.emit("disconnect");

            this._connected = false;

            var paths = [];
            for (var path in this._nodesByFilePath) {
                paths.push(path);
            }

            this._reset();

            paths.forEach(function (path) {
                this.emit("scriptWentAway", [path]);
            }.bind(this));
        }.bind(this));
    };

    Agent.prototype._onConnect = function () {
        this._connected = true;

        this.emit("connect");

        // get the handle to use for tracking hits
        this._invoke("trackHits", [], function (handle) {
            this._hitsHandle = handle;
        }.bind(this));

        this._invoke("trackExceptions", [], function (handle) {
            this._exceptionsHandle = handle;
        }.bind(this));

        // poll for new nodes
        this._invoke("trackNodes", [], function (handle) {
            var id = setInterval(function () {
                this._invoke("newNodes", [handle], function (nodes) {
                    if (nodes) {
                        this._addNodes(nodes);
                    }
                }.bind(this));
            }.bind(this), 1000);

            this._conn.disconnected.done(function () {
                clearInterval(id);
            });
        }.bind(this));
    };

    Agent.prototype.init = function (port) {
        this._connect(port);
    };

    Agent.prototype.isReady = function () {
        return this._connected;
    };

    Agent.prototype.disconnect = function () {
        this._conn.disconnect();
    }

    Agent.prototype.functionWithId = function (fid) {
        return this._nodes[fid];
    };

    Agent.prototype.functionsInFile = function (path) {
        for (var remotePath in this._nodesByFilePath) {
            if (Agent.couldBeRemotePath(path, remotePath)) {
                var nodes = this._nodesByFilePath[remotePath];
                if (nodes) {
                    return nodes.filter(function (n) { return n.type === "function" });
                }
            }
        }
        return [];
    };

    Agent.prototype.functions = function() {
        return _.flatten(_.filter(this._nodesByFilePath, function (n, path) {
            return (path !== "[built-in]");
        }), true).filter(function (n) {
            return (n.type === "function");
        });
    };

    Agent.prototype.probesInFile = function (path) {
        for (var remotePath in this._nodesByFilePath) {
            if (Agent.couldBeRemotePath(path, remotePath)) {
                var nodes = this._nodesByFilePath[remotePath];
                if (nodes) {
                    return nodes.filter(function (n) { return n.type === "probe" });
                }
            }
        }
        return [];
    };

    Agent.prototype.refreshHitCounts = function (callback) {
        if (this._hitsHandle === undefined) {
            callback && callback();
            return;
        }

        this._invoke("hitCountDeltas", [this._hitsHandle], function (deltas) {
            if (deltas) {
                for (var id in deltas) {
                    this._nodeHitCounts[id] = (this._nodeHitCounts[id] || 0) + deltas[id];
                }
                callback && callback(this._nodeHitCounts, deltas);
            } else {
                callback && callback(this._nodeHitCounts, {});
            }
        }.bind(this));
    };

    Agent.prototype.refreshExceptionCounts = function (callback) {
        if (this._exceptionsHandle === undefined) {
            callback && callback();
            return;
        }

        _invoke("newExceptions", [this._exceptionsHandle], function (exceptions) {
            if (exceptions) {
                for (var id in exceptions.counts) {
                    this._nodeExceptionCounts[id] = (this._nodeExceptionCounts[id] || 0) + exceptions.counts[id];
                }
                callback && callback(this._nodeExceptionCounts, exceptions.counts);
            } else {
                callback && callback(this._nodeExceptionCounts, {});
            }
        });
    };

    Agent.prototype.cachedHitCounts = function () {
        return this._nodeHitCounts;
    };

    Agent.prototype.trackLogs = function (query, callback) {
        this._invoke("trackLogs", [query], callback);
    };

    Agent.prototype.refreshLogs = function (handle, maxResults, callback) {
        this._invoke("logDelta", [handle, maxResults], function (results) {
            if (results) {
                results.forEach(function (entry) {
                    entry.source = "node";
                });
            }
            callback(results);
        });
    };

    Agent.prototype.backtrace = function (options, callback) {
        this._invoke("backtrace", [options], function (backtrace) {
            if (backtrace) {
                backtrace.forEach(function (entry) {
                    entry.source = "node";
                });
                callback(backtrace);
            } else {
                callback();
            }
        });
    };

    Agent.prototype.resetTrace = function () {
        if (this._connected) {
            var realDisconnect = false;
            var detectRealDisconnect = function () {
                realDisconnect = true;
            };

            // make everyone think we've disconnected
            this.emit("disconnect"); // simulated

            // detect whether we *actually* get disconnected before we emit another "connected" event
            this.on("disconnect", detectRealDisconnect);

            // clear all the locally cached trace data
            this._reset();

            // clear the remote trace data
            this._invokePromise("resetTrace", []).always(function () {
                this.removeListener("disconnect", detectRealDisconnect);

                // if there wasn't a real disconnection in the meantime, simulate a reconnection
                if (!realDisconnect) {
                    this._onConnect();
                }
            }.bind(this));
        }
    };

    function wrapServerFunction (localName, remoteName) {
        Agent.prototype[localName] = function () {
            return this._invokePromise(remoteName, Array.prototype.slice.apply(arguments));
        };
    }

    var trackerFunctions = {
        trackNodes: "trackNodes",
        untrackNodes: "untrackNodes",
        nodeDelta: "newNodes",

        trackEpochs: "trackEpochs",
        untrackEpochs: "untrackEpochs",
        epochDelta: "epochDelta",

        trackExceptions: "trackExceptions",
        untrackExceptions: "untrackExceptions",
        exceptionDelta: "newExceptions",

        trackFileCallGraph: "trackFileCallGraph",
        untrackFileCallGraph: "untrackFileCallGraph",
        fileCallGraphDelta: "fileCallGraphDelta",

        trackProbeValues: "trackProbeValues",
        untrackProbeValues: "untrackProbeValues",
        probeValuesDelta: "probeValuesDelta",

        logCount: "logCount",
    };
    for (var fname in trackerFunctions) {
        wrapServerFunction(fname, trackerFunctions[fname]);
    }

    exports.Agent = Agent; 
    exports.Deferred = Deferred;
}());
