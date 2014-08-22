/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var ExtensionLoader = brackets.getModule("utils/ExtensionLoader");
	var Agent;
	var AgentManager; 
	// var AgentManager 	= require("./theseus/AgentManager");
	// var AgentManager	= require("../theseus/src/AgentManager");

	var _tracedFunctions = [];
	var _logHandles = [];

	function init () {
		Agent 			= ExtensionLoader.getRequireContextForExtension("theseus")("./src/Agent");
		AgentManager 	= ExtensionLoader.getRequireContextForExtension("theseus")("./src/AgentManager");

		Agent.init(); 
		AgentManager.init();

		_enable(); 
	}

	function _enable () {
		$(Agent).on("receivedScriptInfo", _receivedScriptInfo);
        $(Agent).on("scriptWentAway", _scriptWentAway);

        setInterval(_updateLoop, 100);
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
    			var resultsToPassOn = [];

    			if (!Array.isArray(results)) {
    				results = [results];
    			}

    			results = _.sortBy(results, "invocationId");

    			for (var i = 0; i < results.length; i++) {
    				var result = results[i]; 
    				var resultToPassOn = { 
    					functionIdentifier: result.nodeId,
    					theseusInvocationId: result.invocationId
    				};

					var argumentNames = _.pluck(result.arguments, "name");
					resultToPassOn.argumentTypes = _.chain(result.arguments).pluck("value").pluck("typeSpec").value();
					for (var j = 0; j < resultToPassOn.argumentTypes.length; j++) {
						resultToPassOn.argumentTypes[j].name = argumentNames[j];
					}

					resultToPassOn.lastArguments = result.arguments; 
					resultToPassOn.returnType = result.returnValue.typeSpec; 

					resultsToPassOn.push(resultToPassOn); 
    			}
    			
    			$(exports).trigger("didReceiveTypeInformation", [ exports, resultsToPassOn, true ]); 
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
    exports.callingInvocationForFunctionInvocation = callingInvocationForFunctionInvocation; 

});