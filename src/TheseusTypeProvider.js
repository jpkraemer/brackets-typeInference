/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var Agent 			= require("./theseus/Agent"); 
	var AgentManager 	= require("./theseus/AgentManager");

	var _tracedFunctions = [];
	var _logHandles = [];

	function init () {
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
    				var resultToPassOn = { functionIdentifier: result.nodeId };

					var argumentNames = _.pluck(result.arguments, "name");
					resultToPassOn.argumentTypes = _.chain(result.arguments).pluck("value").pluck("typeSpec").value();
					for (var j = 0; j < resultToPassOn.argumentTypes.length; j++) {
						resultToPassOn.argumentTypes[j].name = argumentNames[j];
					}

					resultToPassOn.lastArguments = result.arguments; 
					resultToPassOn.returnType = result.returnValue.typeSpec; 

					resultsToPassOn.push(resultToPassOn); 
    			}
    			
    			$(exports).trigger("didReceiveTypeInformation", [ resultsToPassOn ]); 
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

});