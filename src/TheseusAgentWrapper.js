 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var ExtensionLoader = brackets.getModule("utils/ExtensionLoader");
	
	var Agent 			= ExtensionLoader.getRequireContextForExtension("theseus")("./src/Agent");
	var AgentManager 	= ExtensionLoader.getRequireContextForExtension("theseus")("./src/AgentManager");

	var _subscriptions = [];
	var _tracedFunctions = [];
	var _logHandles = [];

	function init () {
		Agent 			= ExtensionLoader.getRequireContextForExtension("theseus")("./src/Agent");
		AgentManager 	= ExtensionLoader.getRequireContextForExtension("theseus")("./src/AgentManager");

		Agent.init(); 
		AgentManager.init();

		$(Agent).on("receivedScriptInfo", _receivedScriptInfo);
        $(Agent).on("scriptWentAway", _scriptWentAway);

        setInterval(_updateLoop, 100);
	}

	/**
	 * Register for Updates from theseus. Filter can be either compatible with lodash's _.filter function or be an array of 
	 * function identifiers. 
	 * @param  {Any}   		filter        
	 * @param  {Function} 	callback       Called when new results matching the filter are found. Should accept an array parameter. 
	 * @return  {string}   	registrationId optional id to pass that is required to remove the subscription later
	 */
	function registerForTheseusUpdates(filter, callback) {
		var allRegistrationIds = _.pluck(_subscriptions, "registrationId");
		var registrationId;
		do {
			registrationId = Math.random().toString(36).substr(2,10);
		} while (allRegistrationIds.indexOf(registrationId) !== -1); 

		_subscriptions.push({
			filter: filter, 
			callback: callback, 
			registrationId: registrationId
		}); 

		return registrationId;
	}

	/**
	 * Cancel the subscription for updates for the given registration id 
	 * @param  {string} registrationId 
	 */
	function unregisterForTheseusUpdates(registrationId) {
		_.remove(_subscriptions, { registrationId: registrationId });
	}

	function _scriptWentAway (event, path) {
		
	}

	function _receivedScriptInfo (event, path) {
		if (path !== "[built-in]") {
			//each time a new file is indexed by the agent, we start tracking call logs for all functions in the file 
			var functionsInFile = Agent.functionsInFile(path);

			_tracedFunctions = _.uniq(_tracedFunctions.concat(functionsInFile), "id");
			
			if (functionsInFile.length !== 0) {
				Agent.trackLogs({
					ids: _.pluck(functionsInFile, "id"),
					eventNames: [],
					exceptions: false,
					logs: false
				}, function (handle) {
					_logHandles.push(handle);
					_logHandles = _.uniq(_logHandles);
				});
			}
		}
	}

	/**
	 * Find the callsite for a given invocationId from theseus
	 * @param  {string} invocationId
	 * @return {{ range: { start: { line: number, ch: number }, end: { line: number, ch: number } } }}
	 */
	function callingInvocationForFunctionInvocation (invocationId) {
		var result = $.Deferred();

		Agent.backtrace({
			invocationId: invocationId,
			range: [ 0, 2 ]
		}, function (backtrace) {
			if (backtrace && backtrace.length === 2) {
				var call = _.last(backtrace); 
				var components = _.map(call.nodeId.split("-"), Number).slice(-4); 
				var rangeAtTheEnd = _.every(components, function (component) {
					return (! isNaN(component));
				});

				if (rangeAtTheEnd) {
					call.range = {
						start: {
							line: components[0],
							ch: components[1]
						},
						end: {
							line: components[2],
							ch: components[3]
						}
					};

					result.resolve(call);
					return;
				}
			}

			result.reject("No location or caller found");
		});

		return result.promise();
	}
	
	/**
	 * This method is just called periodically to search for new Theseus results
	 */
	function _updateLoop () {
		var newLogsHandler = function (results) {
    		if (results && results.length > 0) {
    			if (!Array.isArray(results)) {
    				results = [results];
    			}

				var arrayFilter = function (result) {
					return (this.indexOf(result.nodeId) > -1);
				};

    			for (var i = 0; i < _subscriptions.length; i++) {
    				var subscription = _subscriptions[i];
    				var filter = subscription.filter; 
    				if (Array.isArray(filter)) {
    					filter = arrayFilter.bind(subscription.filter);
    				}

    				var resultsToPassOn = _.filter(results, filter);
    				if (resultsToPassOn.length > 0) {
    					subscription.callback(resultsToPassOn); 
    				}
    			}
    		}
    	};

    	if (Agent.isReady()) {
    		for (var i = 0; i < _logHandles.length; i++) {
    			var logHandle = _logHandles[i];
	    		Agent.refreshLogs(logHandle, 20, newLogsHandler);	
	    	}
    	}
    }

    exports.init = init; 
    exports.registerForTheseusUpdates = registerForTheseusUpdates;
    exports.unregisterForTheseusUpdates = unregisterForTheseusUpdates;
    exports.callingInvocationForFunctionInvocation = callingInvocationForFunctionInvocation; 
});