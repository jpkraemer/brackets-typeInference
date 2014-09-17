/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global module, exports, require, process */

(function () {
	"use strict";

	var exec 	= require("child_process").exec;
	var fs		= require("fs");
	var path 	= require("path");
	var vm		= require("vm");
	var xml2js	= require("xml2js");
	var jasmine = require("jasmine-node/lib/jasmine-node/index"); 

	function runTestsInPath (fullPath, errback) {
		var onComplete = function (runner, log) {
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
								var newTestResult = {
									title: testcase.$.name,
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
			if (! fs.existsSync(reportPath)) {
				fs.mkdirSync(reportPath);
			}

			var options = {
				specFolders: [ fullPath ],
				onComplete: onComplete,
				isVerbose: false,
				junitreport: {
					report: true,
					savePath: reportPath,
					useDotNotation: true,
					consolidate: true
				},
				includeStackTrace: true,
				growl: false
			};

			jasmine.executeSpecsInFolder(options);
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
