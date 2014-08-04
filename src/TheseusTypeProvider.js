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
	var _logHandle;

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
		//each time a new file is indexed by the agent, we start tracking call logs for all functions in the file 

		var functionsInFile = Agent.functionsInFile(path);

		_tracedFunctions = _.uniq(_tracedFunctions.concat(functionsInFile), "id");
		_.remove(_tracedFunctions, { path: "[built-in]" }); 

		if (_tracedFunctions.length !== 0) {
			Agent.trackLogs({
				ids: _.pluck(_tracedFunctions, "id"),
				eventNames: [],
				exceptions: false,
				logs: false
			}, function (handle) {
				_logHandle = handle; 
			});
		}
	}
	
	function _updateLoop () {
    	if (Agent.isReady()) {
	    	Agent.refreshLogs(_logHandle, 20, function (results) {
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

						resultsToPassOn.push(resultToPassOn); 
	    			}
	    			
	    			$(exports).trigger("didReceiveTypeInformation", [ resultsToPassOn ]); 
	    		}
	    	});	
    	}
    }

    exports.init = init; 

});