 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var ExtensionLoader = brackets.getModule("utils/ExtensionLoader");
	
	var Agent;// 			= ExtensionLoader.getRequireContextForExtension("theseus")("./src/Agent");
	var AgentManager;// 	= ExtensionLoader.getRequireContextForExtension("theseus")("./src/AgentManager");

	var _subscriptions = [];
	var _tracedFunctions = [];
	var _logHandles = [];
	var _cachedResults = [];

	ExtensionLoader.getRequireContextForExtension("theseus")([ "./src/Agent", "./src/AgentManager" ], function (newAgent, newAgentManager) {
		/**
		 * This method is just called periodically to search for new Theseus results
		 */
		function _updateLoop () {
			var newLogsHandler = function (results) {
	    		if (results && results.length > 0) {
	    			if (!Array.isArray(results)) {
	    				results = [results];
	    			}

	    			_cachedResults = _cachedResults.concat(results);

	    			for (var i = 0; i < _subscriptions.length; i++) {
	    				var subscription = _subscriptions[i];
	    				_notifySubscriptionAboutResults(subscription, results); 
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

	    Agent = newAgent; 
	    AgentManager = newAgentManager;

	    Agent.init(); 
		AgentManager.init();

		$(Agent).on("receivedScriptInfo", _receivedScriptInfo);
        $(Agent).on("scriptWentAway", _scriptWentAway);

        setInterval(_updateLoop, 100);
	});

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

		var subscription = {
			filter: filter, 
			callback: callback, 
			registrationId: registrationId
		};

		_subscriptions.push(subscription); 

		_notifySubscriptionAboutResults(subscription, _cachedResults);

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
		console.log("went away");
		_cachedResults = [];
		_tracedFunctions =[];
		_logHandles = [];
	}

	function _receivedScriptInfo (event, path) {
		console.log("came in");
		if (path !== "[built-in]") {
			//each time a new file is indexed by the agent, we start tracking call logs for all functions in the file 
			var functionsInFile = Agent.functionsInFile(path);

			_.remove(functionsInFile, function (functionInFile) {
				return (_.find(_tracedFunctions, { id: functionInFile.id }) !== undefined);
			});

			if (functionsInFile.length !== 0) {
				_tracedFunctions = _.uniq(_tracedFunctions.concat(functionsInFile), "id");
				
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

	function _notifySubscriptionAboutResults (subscription, results) {
		var arrayFilter = function (result) {
			return (this.indexOf(result.nodeId) > -1);
		};
		
		var filter = subscription.filter; 

		if (Array.isArray(filter)) {
			filter = arrayFilter.bind(subscription.filter);
		}

		var resultsToPassOn = _.filter(results, filter);
		if (resultsToPassOn.length > 0) {
			subscription.callback(resultsToPassOn); 
		}
	}

    exports.registerForTheseusUpdates = registerForTheseusUpdates;
    exports.unregisterForTheseusUpdates = unregisterForTheseusUpdates;
    exports.callingInvocationForFunctionInvocation = callingInvocationForFunctionInvocation; 
});