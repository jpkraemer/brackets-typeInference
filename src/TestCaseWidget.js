 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var CodeWidget			= require("./CodeWidget");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var EditorManager 		= brackets.getModule("editor/EditorManager");
	var ProjectManger		= brackets.getModule("project/ProjectManager");
	var TestCasesProvider	= require("./TestCasesProvider");
	var TIUtils 			= require("./TIUtils");

	/**
	 * @constructor
	 * Renders a single test case. 
	 * @param {{title: string, isSuggestion: boolean}} options
	 */
	function TestCaseWidget (testCase) {
		CodeWidget.call(this);

		_.bindAll(this);

		//add missing html
		this.$container.addClass('ti-testCase');
		this.$container.find(".ti-headerLine").prepend($("<span />").addClass("ti-testStatusIndicator"));
		this.$container.find(".ti-header").append($("<span />").addClass("ti-button ti-addButton"));
		this.$caption.attr('contenteditable', 'true'); 

		//configure behavior
		this.testCase = testCase;
		$(TestCasesProvider).on("updatedTestResults", this.didUpdateTestResults);
		this.$caption.on("click", this._onCaptionClicked); 
		this.$caption.on("keydown", this._onCaptionKeydown); 
	}

	TestCaseWidget.prototype = Object.create(CodeWidget.prototype);
	TestCaseWidget.prototype.constructor = TestCaseWidget; 
	TestCaseWidget.prototype.parentClass = CodeWidget.prototype;

	TestCaseWidget.prototype._isSuggestion = undefined;
	TestCaseWidget.prototype._testResult = undefined;

	Object.defineProperties(TestCaseWidget.prototype, {
		"$statusIndicator": {
			get: function () { return this.$container.find(".ti-testStatusIndicator"); },
			set: function () { throw new Error("Cannot set $statusIndicator"); }
		},
		"$addRemoveButton": {
			get: function () { return this.$container.find(".ti-header .ti-button"); },
			set: function () { throw new Error("Cannot set $statusIndicator"); }
		},
		"$calledFunctionsTableWrapper": {
			get: function () { return this.$container.find(".ti-callsTableWrapper"); },
			set: function () { throw new Error("Cannot set $statusIndicator"); }	
		},
		"isSuggestion": {
			get: function () { return this._isSuggestion; },
			set: function (value) {
				if (this._isSuggestion === value) {
					return; 
				}

				this._isSuggestion = value;
				if (this._isSuggestion === true) {
					this.$container.addClass('ti-suggestion');
					this.$addRemoveButton.removeClass('ti-removeButton');
					this.$addRemoveButton.addClass('ti-addButton');
				} else {
					this.$container.removeClass('ti-suggestion');
					this.$addRemoveButton.removeClass('ti-addButton');
					this.$addRemoveButton.addClass('ti-removeButton');
				}
			}
		},
		"testCase": {
			get: function () { 
				this._testCase.code = this.code;
				this._testCase.title = this.$container.find(".ti-caption").text();

				return this._testCase; 
			},
			set: function (newTestCase) { 
				this._testCase = newTestCase; 

				this.code = this._testCase.code;
				this.$caption.text(this._testCase.title);
				this.isSuggestion = this._testCase.isSuggestion || false;
			}
		},
		"testResult": {
			get: function () { return this._testResult; },
			set: function (newTestResult) {
				this._testResult = newTestResult;
				this._updateStatusIndicator();
				this._updateCalledFunctions();
			}
		}
	});

 	TestCaseWidget.prototype._updateCalledFunctions = function() {
 		var $headerLine = this.$container.find(".ti-header > .ti-headerLine");
 		var shouldShowCalledFunctions = ((this.testResult.calledFunctions !== undefined) && (this.testResult.calledFunctions.length > 0)); 

 		var updateCalledFunctionsLink = function () {
 			var $calledFunctionsLink = $headerLine.find(".ti-calls"); 

 			if (shouldShowCalledFunctions) {
	 			if ($calledFunctionsLink.length === 0) {
					$calledFunctionsLink = $("<a />").addClass('ti-calls');
					$calledFunctionsLink.on("click", this._onCalledFunctionsLinkClicked);
					var $wrapper = $("<span />").html("&mdash;").append($calledFunctionsLink);
					$headerLine.append($wrapper);
	 			}

	 			var callCount = this.testResult.calledFunctions.length; 
	 			var text = "Calling " + callCount + " function"; 
	 			if (callCount > 1) {
	 				text += "s";
	 			}
	 			$calledFunctionsLink.text(text);
	 		} else {
	 			$calledFunctionsLink.parent().remove();
	 		}
 		}.bind(this);

 		var updateCalledFunctionsTable = function () {
 			var $calledFunctionsTableWrapper = this.$calledFunctionsTableWrapper;
 			var wasVisible = $calledFunctionsTableWrapper.is(":visible");
 			$calledFunctionsTableWrapper.remove();

 			if (shouldShowCalledFunctions) {
 				$calledFunctionsTableWrapper = $("<div />").addClass('ti-callsTableWrapper');
 				$("<h2 />").addClass('ti-headline').text("Called Functions").appendTo($calledFunctionsTableWrapper);

				var $calledFunctionsTable = $("<table />");
				for (var i = 0; i < this.testResult.calledFunctions.length; i++) {
					var calledFunction = this.testResult.calledFunctions[i]; 
					var $tableRow = $("<tr />"); 
					
					$("<td />").text(ProjectManger.makeProjectRelativeIfPossible(calledFunction.functionInfo.path)).appendTo($tableRow); 
					$("<td />").text(calledFunction.functionInfo.name).appendTo($tableRow); 
					$("<td />").appendTo($tableRow).append(
						$("<a />").text("Show call").on('click', this._onShowCallClicked.bind(this, calledFunction))
					); 

					$calledFunctionsTable.append($tableRow); 
				}

				$calledFunctionsTableWrapper.append($calledFunctionsTable);
				if (! wasVisible) {
					$calledFunctionsTableWrapper.hide();
				}
				$calledFunctionsTableWrapper.insertAfter(this.$container.find(".ti-header"));
			}
		}.bind(this); 

 		updateCalledFunctionsLink();
 		updateCalledFunctionsTable(); 		
 	};

 	TestCaseWidget.prototype._updateStatusIndicator = function() {
 		var $statusIndicator = this.$container.find(".ti-testStatusIndicator");
		if (this.testResult.success) {
			$statusIndicator.removeClass('ti-testStatusFailed');
		} else {
			$statusIndicator.addClass('ti-testStatusFailed');
		}
 	};

	TestCaseWidget.prototype.didUpdateTestResults = function(event, results) {
		if (results[this.testCase.functionIdentifier]) {
			var testResult = _.find(results[this.testCase.functionIdentifier], { id: this.testCase.id });
			if (testResult !== undefined) {
				this.testResult = testResult;
			}
		}
	};

	TestCaseWidget.prototype._onShowCallClicked = function(calledFunction) {

		var highlightRangeInCodeMirror = function(range, codeMirror) {
			for (var i = range.start.line; i <= range.end.line; i++) {
				codeMirror.addLineClass(i, "background", "ti-highlight");	
			}
			
            setTimeout(function () {
            	for (var i = range.start.line; i <= range.end.line; i++) {
	                codeMirror.removeLineClass(i, "background", "ti-highlight");
	            }
            }, 2000);
		};

		var rangeFromNodeId = function (nodeId) {
			var nodeIdComponents = nodeId.split("-"); 
			var rangeComponents = nodeIdComponents.slice(-4);
			var range; 
			if (_.every(rangeComponents, function (element) { return ! isNaN(element); })) {
				range = {
					start: {
						line: Number(rangeComponents[0]),
						ch: Number(rangeComponents[1])
					},
					end: {
						line: Number(rangeComponents[2]),
						ch: Number(rangeComponents[3])
					}
				};
			}

			return range;
		};

		var highlightCallInTest = function () { 
			var call = calledFunction.backtrace[calledFunction.backtrace.length - 2];
			var range = rangeFromNodeId(call.nodeId); 
			if (range !== undefined) {
				range.start.line -= this.testCase.sourceLocation.start.line;
				range.end.line -= this.testCase.sourceLocation.start.line;
				if (range.start.line === 0) {
					range.start.ch -= this.testCase.sourceLocation.start.column; 
				}

				if ((range.start.line >= 0) && 
					(range.start.ch >= 0) &&
					(range.end.line <= this.testCase.sourceLocation.end.line - this.testCase.sourceLocation.start.line)) {

					if (this.$container.find('.ti-editorHolder').is(":hidden")) {
						this.toggleSourceCodeVisible();
					}

					highlightRangeInCodeMirror(range, this.codeMirror);
				}
			}
		}.bind(this);

		var highlightCalledMethodInEditor = function () {
			var currentDocument = DocumentManager.getCurrentDocument(); 
			if (currentDocument.file.fullPath !== calledFunction.functionInfo.path) {
				var newDoc = DocumentManager.getDocumentForPath(calledFunction.functionInfo.path); 
				DocumentManager.setCurrentDocument(newDoc);
			}

			var currentFullEditor = EditorManager.getCurrentFullEditor(); 
			var adjustedRange = { 
				start: calledFunction.functionInfo.start, 
				end: calledFunction.functionInfo.end 
			};
			adjustedRange.start.line -= 1; 
			adjustedRange.end.line -= 1; 

			highlightRangeInCodeMirror(adjustedRange, currentFullEditor._codeMirror);
		};

		highlightCalledMethodInEditor();
		highlightCallInTest(); 
	};

	TestCaseWidget.prototype._onCalledFunctionsLinkClicked = function(event) {
		this.$calledFunctionsTableWrapper.slideToggle('fast');
		event.stopPropagation();
	};

	TestCaseWidget.prototype._onCaptionClicked = function(event) {
		event.stopPropagation();
	};

	TestCaseWidget.prototype._onEditorKeyEvent = function(theEditor, event) {
		if (theEditor !== this.codeMirror) {
			TIUtils.log("_onEditorKeyEvent called with invalid editor");
			return; 
		}

		var cursorPos = this.codeMirror.getCursor();

		if ((event.keyCode === 38) && (cursorPos.line === 0)) {
	        this.$caption.focus();
        } else {
        	CodeWidget.prototype._onEditorKeyEvent.apply(this, arguments);
        }
    };

    TestCaseWidget.prototype._onCaptionKeydown = function (event) {
    	if (event.keyCode === 38) {
    		$(this).trigger("cursorShouldMoveToOtherWidget", "up");
    	} else if (event.keyCode === 40) {
    		this.codeMirror.focus();
    	}
    };

	module.exports = TestCaseWidget;  
});