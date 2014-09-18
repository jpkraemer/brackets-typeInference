/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global module, exports, require, process */

(function () {
	"use strict";

	var exec 	= require("child_process").exec;
	var fs		= require("fs");
	var path 	= require("path");
	var vm		= require("vm");
	var xml2js	= require("xml2js");
	
	var SEPARATOR = "$$";


	function runTestsInPath (jasminePath, fullPath, errback) {
		var onComplete = function (err, stdout, stderr) {
			var result = {};
			if (fs.existsSync(reportPath) && (fs.statSync(reportPath).isDirectory())) {
				var files = fs.readdirSync(reportPath);
				for (var i = 0; i < files.length; i++) {
					var file = files[i]; 
					var reportFilePath = reportPath + "/" + file; 

					var xmlString = fs.readFileSync(reportFilePath).toString();
					xml2js.parseString(xmlString, function (err, xml) {
						for (var j = 0; j < xml.testsuites.testsuite.length; j++) {
							var testsuite = xml.testsuites.testsuite[j]; 
							var resultTestCases = []; 

							for (var k = 0; k < testsuite.testcase.length; k++) {
								var testcase = testsuite.testcase[k];
								var testcaseNameComponents = testcase.$.name.split(SEPARATOR); 
								var newTestResult = {
									id: testcaseNameComponents[0],
									title: testcaseNameComponents.slice(1).join(SEPARATOR),
									time: testcase.$.time,
									success: ! testcase.hasOwnProperty("failure")
								};

								if (! newTestResult.success) {
									newTestResult.failure = testcase.failure[0].$;
									newTestResult.failure.backtrace = testcase.failure[0]._; 
								}

								resultTestCases.push(newTestResult);
							}

							result[testsuite.$.name] = resultTestCases;
						}
					});

					fs.unlinkSync(reportFilePath);
				}

				fs.rmdirSync(reportPath);
			}
			
			errback("", result);
		};

		if (fs.existsSync(fullPath) && (fs.statSync(fullPath).isDirectory())) {
			var reportPath = path.join(fullPath, "/reports/");
			exec(process.execPath + " " + jasminePath + " --junitreport --output " + reportPath + " " + fullPath, onComplete);
		}
	}

	function init (domainManager) {
		if (!domainManager.hasDomain("TITestRunner")) {
			domainManager.registerDomain("TITestRunner", {major: 0, minor: 1}); 
		}

		domainManager.registerCommand(
			"TITestRunner",
			"runTestsInPath",
			runTestsInPath,
			true, 
			"Removes documents from the database",
			[ {
				name: "fullPath", 
				type: "string",
				description: "A full path to a directory with specs"
			} ], 
			[ {
				name: "testResults",
			  	type: "object",
			  	description: "The results of the tests"
			} ]
		);
	}

	exports.init = init;
}());
