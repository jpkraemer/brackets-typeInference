/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global module, exports, require, process */

(function () {
	"use strict";

	var _ 			= require("lodash");
	var spawn 		= require("child_process").spawn;
	var exec 		= require("child_process").exec;
	var fs			= require("fs");
	var path 		= require("path");
	var vm			= require("vm");
	var xml2js		= require("xml2js");
	var NodeAgent 	= require("./Node-Agent").Agent;
	var Deferred 	= require("./Node-Agent").Deferred;
	
	var SEPARATOR = "$$";

	function runTestsInPath (jasminePath, specPath, errback) {

		var reportPath; 
		var nodeTheseusProcess;
		var nodeAgent;

		var collectTheseusInformation = function () {
			var testCaseNameCache = {}; 
			var testInfoForTheseusFunctionId = function (functionId) {
				var components = functionId.split("-");
				var filename = components.slice(0, -5).join("-"); 
				if (testCaseNameCache[filename] === undefined) {
					testCaseNameCache[filename] = {
						lines: fs.readFileSync(filename).toString().split("\n")
					};
				}
				var rangeString = components.slice(-4).join("-");
				if (testCaseNameCache[filename][rangeString] === undefined) {
					var lineIndex = Number(components.slice(-4)[0]) - 1;
					var line = testCaseNameCache[filename].lines[lineIndex];
					var regexResults = line.match(/it\('(.*)', function/);
					if (regexResults !== null) {
						var nameParts = regexResults[1].split(SEPARATOR);
						var testId = nameParts[0]; 
						var testTitle = nameParts.slice(1).join(SEPARATOR);
						testCaseNameCache[filename][rangeString] = {
							title: testTitle,
							id: testId,
							calledFunctions: []
						};
					}
				}

				return testCaseNameCache[filename][rangeString];
			};

			var collectingTheseusInfoPromise = new Deferred(); 

			nodeAgent = new NodeAgent();
			nodeAgent.init(8889); 
			nodeAgent.on("receivedScriptInfo", function (paths) {

				if (paths.length === 0) {
					return;
				}

				var functions = nodeAgent.functions().filter(function (node) {
					return (node.path.indexOf(specPath) !== 0);
				});

				if (functions.length !== 0) {
					nodeAgent.trackLogs({
						ids: _.pluck(functions, "id"),
						eventNames: [],
						exceptions: false,
						logs: false
					}, function (handle) {
						nodeAgent.refreshLogs(handle, Number.MAX_VALUE, function (results) {
							var invocationIds = _.pluck(results, "invocationId");
							var completedBacktracesCounter = 0;
							var parseBacktrace = function (backtrace) {
								for (var i = 1; i < backtrace.length; i++) {
									var call = backtrace[i];
									if (call.nodeId.indexOf(specPath) === 0) {
										var testCaseInfo = testInfoForTheseusFunctionId(call.nodeId);
										if (testCaseInfo !== undefined) {
											testCaseInfo.calledFunctions.push(backtrace[0]);
										}
										break;
									}
								}

								completedBacktracesCounter++;
								if (completedBacktracesCounter === invocationIds.length) {
									collectingTheseusInfoPromise.resolve(testCaseNameCache);
								}
							};
							for (var i = 0; i < invocationIds.length; i++) {
								var invocationId = invocationIds[i];
								nodeAgent.backtrace({
									invocationId: invocationId,
									range: [ 0, 10 ]
								}, parseBacktrace);
							}
						});
					});
				}
			});

			return collectingTheseusInfoPromise;
		};

		var onComplete = function (err, stdout, stderr) {
			var result = {};
			
			if (fs.existsSync(reportPath) && (fs.statSync(reportPath).isDirectory())) {
				var parseTestSuiteFromXML = function (err, xml) {
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
				};

				var files = fs.readdirSync(reportPath);

				for (var i = 0; i < files.length; i++) {
					var file = files[i]; 
					var reportFilePath = reportPath + "/" + file; 

					var xmlString = fs.readFileSync(reportFilePath).toString();
					xml2js.parseString(xmlString, parseTestSuiteFromXML);
				}
			}

			collectTheseusInformation().done(function (theseusResult) {
				var allTestCases = _.flatten(_.values(result), true);
				var allTestInfos = _(theseusResult).values().map(function (x) { return _(x).omit("lines").values().value(); }).flatten().value();
				for (var i = 0; i < allTestInfos.length; i++) {
					var testInfo = allTestInfos[i];
					var testResult = _.find(allTestCases, { title: testInfo.title, id: testInfo.id });
					testResult.calledFunctions = testInfo.calledFunctions;
				}

				cleanup();

				errback("", result);
			});
		};

		var cleanup = function () {
			if (fs.existsSync(reportPath) && (fs.statSync(reportPath).isDirectory())) {
				var files = fs.readdirSync(reportPath);
				for (var i = 0; i < files.length; i++) {
					var file = files[i]; 
					var reportFilePath = reportPath + "/" + file; 

					fs.unlinkSync(reportFilePath);
				}

				fs.rmdirSync(reportPath); 
			}

			nodeAgent.disconnect();
			nodeTheseusProcess.kill();
		};

		specPath = path.resolve(specPath);

		if (fs.existsSync(specPath) && (fs.statSync(specPath).isDirectory())) {
			reportPath = path.join(specPath, "/reports/");
			nodeTheseusProcess = spawn(process.execPath, jasminePath.split(" ").concat([ "--junitreport",  "--output", reportPath, specPath ]));

			nodeTheseusProcess.stdout.on("data", function (data) {
				if (/Finished\ in/.test(data.toString())) {
					onComplete();
				} 
			});
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
			"Runs the tests in the given directory",
			[ {
				name: "jasminePath",
				type: "string",
				description: "The path to the jasmine cli script"
			},
			{
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
