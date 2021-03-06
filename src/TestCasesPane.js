 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 							= require("./lib/lodash");
	var Resizer 					= brackets.getModule("utils/Resizer");
	var BeforeAfterWidget			= require("./BeforeAfterWidget");
	var CodeMirror 					= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var DocumentManager 			= brackets.getModule("document/DocumentManager"); 
	var MainViewManager				= brackets.getModule("view/MainViewManager");
	var EditorManager				= brackets.getModule("editor/EditorManager");
	var PreviousExecutionsWidget	= require("./PreviousExecutionsWidget");
	var ProjectManager				= brackets.getModule("project/ProjectManager");
	var TemplateWidget				= require("./TemplateWidget");
	var TestCaseCollectionManager	= require("./TestCaseCollectionManager");
	var TestCaseSuggestionGenerator = require("./TestCaseSuggestionGenerator");
	var TestCaseWidget				= require("./TestCaseWidget");
	var TIDropdown					= require("./TIDropdown");
	var TIUtils						= require("./TIUtils");
	
	var EVENT_NAMESPACE = ".TestCasesPane"; 

	$.fn.extend({
		slideDownWithFade: function (speed) {
	 		var oldHeight = this.height();
	 		this.height(0);
	 		this.css("opacity", 0);
	 		this.show();

			this.animate({
				height: oldHeight,
				opacity: 1},
				speed
			);

			return this;
		},
		slideUpWithFade: function (speed) {
			var oldHeight = this.height();
			this.animate({
				height: 0,
				opacity: 0},
				speed, 
				function () {
					this.hide(); 
					this.height(oldHeight);
					this.css("opacity", 1);
				}.bind(this)
			);
		}
	});

	var TestCasesPaneMode = {
		suite: "suite", 
		individual: "individualCalling"
	};

	function TestCasesPane () {
		_.bindAll(this);

		this.widgetsBySuite = {};

		this.$pane = $(require("text!./templates/TestCasesPane.html"));
		Resizer.makeResizable(this.$pane.get(0), Resizer.DIRECTION_HORIZONTAL, "left");
		this.$pane.on("panelResizeUpdate", this.onPaneResize);
		$(window).on("resize", this.onPaneResize);

		this.$errorView.hide();

		var $selectorsContainer = this.$pane.find(".ti-testCasesPaneHeader .ti-centerHoriz");

		this._collectionSelector = new TIDropdown(true, false);
		this._collectionSelector.caption = "Suite Collection";
		$(this._collectionSelector).on("change", this._onCollectionSelectorChange); 
		$(this._collectionSelector).on("add", this._onCollectionSelectorAdd); 
		this._collectionSelector.appendTo($selectorsContainer);
		
		this._suiteSelector = new TIDropdown(false, false);
		this._suiteSelector.caption = "Test Suite";
		$(this._suiteSelector).on("change", this._onSuiteSelectorChange); 
		$(this._suiteSelector).on("add", this._onSuiteSelectorChange); 
		this._suiteSelector.appendTo($selectorsContainer);

		this.$pane.find('.ti-roundAddButton').on('click', this.addTestButtonClicked); 

		this.$pane.insertAfter('.pane-content > .not-editor');
		// $('#editor-holder > .CodeMirror').width("50%");

		//respond to events 
		// $(DocumentManager).on("currentDocumentChange", this.currentDocumentChanged); 
		$(MainViewManager).on("currentFileChange", this.currentDocumentChanged);
		this.currentDocumentChanged(null, DocumentManager.getCurrentDocument());

		$(TestCaseCollectionManager).on("updatedTestCollections", this._onUpdatedTestCollections);
		this._onUpdatedTestCollections();

		$(TestCaseCollectionManager).on("updatedTestResults", this._onUpdatedTestResults);
		$(TestCaseCollectionManager).on("updatedError", this._onUpdatedTestError); 

		$(DocumentManager).on("documentSaved", this.documentSaved);

		this.onPaneResize(null, this.$pane.width());
	}

	TestCasesPane.prototype.constructor = TestCasesPane; 

	TestCasesPane.prototype.$pane = undefined;
	TestCasesPane.prototype.codeMirror = undefined;
	TestCasesPane.prototype.currentFullEditor = undefined;
	TestCasesPane.prototype.functionIdentifier = undefined;
	TestCasesPane.prototype.widgetsBySuite = undefined;
	TestCasesPane.prototype.suiteBySuiteId = undefined;
	TestCasesPane.prototype.suggestionWidgets = undefined;
	TestCasesPane.prototype.previousExecutionsWidget = undefined;
	TestCasesPane.prototype._testCaseCollection = undefined;
	TestCasesPane.prototype._testSuite = undefined;
	TestCasesPane.prototype._currentFullEditor = undefined;
	TestCasesPane.prototype._suiteSelector = undefined;
	TestCasesPane.prototype._collectionSelector = undefined;

	Object.defineProperties(TestCasesPane.prototype, {
		"$scrollView": {
			get: function () { return this.$pane.find(".ti-scrollView"); },
			set: function () { throw new Error("Cannot set $scrollView"); }
		},
		"$errorView": {
			get: function () { return this.$pane.find(".ti-testCasesErrorView"); },
			set: function () { throw new Error("Cannot set $errorView"); }
		},
		"testCaseCollection": {
			get: function () { return this._testCaseCollection; },
			set: function (newTestCaseCollection) { 
				this.updateTestCases();
				this._testCaseCollection = newTestCaseCollection; 
				if (this._testCaseCollection) {
					this._updateTestSuiteList();
				}
			}
		}, 
		"isAutomaticSuiteSelectionEnabled": {
			get: function () { return (this._suiteSelector.value === "auto") ? true : false; },
			set: function () { throw new Error("suiteSelectionMode cannot be set"); }
		},
		"currentFullEditor": {
			get: function () { return this._currentFullEditor; }, 
			set: function (newFullEditor) { 
				if (newFullEditor !== this._currentFullEditor) {
					if (this._currentFullEditor !== newFullEditor) {
						if (this._currentFullEditor !== undefined) {
							$(this._currentFullEditor).off(EVENT_NAMESPACE);
						}

						this._currentFullEditor = newFullEditor;
						if (this._currentFullEditor) {
							$(this._currentFullEditor).on("cursorActivity" + EVENT_NAMESPACE, this.cursorMoved);
							this.cursorMoved();
						}
					}
				}
			}
		}, 
		"testSuite": {
			get: function () { 
				return this._testSuite;
			},
			set: function (newTestSuite) { 
				this._testSuite = newTestSuite;
			}
		},
		"testSuiteId": {
			get: function () {
				if ((this._collectionSelector.value === "autogenerated") && (this._suiteSelector.value === "auto")) {
					return this.functionIdentifier;
				} else {
					return this._suiteSelector.value;
				}	
			}, 
			set: function () { throw new Error("Cannot set testSuiteId"); }
		},
		"mode": {
			get: function () {
				if (this._collectionSelector.value === TestCasesPaneMode.individual) {
					return TestCasesPaneMode.individual;
				} else {
					return TestCasesPaneMode.suite;
				}
			}, 
			set: function () { throw new Error("Cannot set mode"); }
		}
	});

 	TestCasesPane.prototype.onPaneResize = function(event, newWidth) {
 		if (this.currentFullEditor) {
	 		var $codeMirrorElement = $(this.currentFullEditor.getRootElement());
	 		if (newWidth === undefined) {
	 			newWidth = this.$pane.width();
	 		}
	 		$codeMirrorElement.width($codeMirrorElement.parent().width() - newWidth - 1); //1px to prevent wrapping
	 		this.currentFullEditor._codeMirror.refresh();
	 	}
 	};

 	TestCasesPane.prototype.closeAddAreaClicked = function(event) {
 		this.$scrollView.find(".ti-addArea").slideUp("fast");
 		this.$scrollView.find(".ti-roundAddButton").slideDownWithFade("fast");
 	};

	TestCasesPane.prototype.addTestButtonClicked = function(event) {
		if (this._collectionSelector.value === "autogenerated") {
			this.$scrollView.find(".ti-roundAddButton").slideUpWithFade("fast");
			this.$scrollView.find(".ti-addArea").slideDown('fast');
		} else {
			this._insertNewTestcase({
				title: "This is a test case", 
				code: "function () {\n\n}",
				isSuggestion: false
			});
		}
	};

	TestCasesPane.prototype.templateAddButtonClicked = function(event) {
		this._insertNewTestcase({
			title: event.target.title,
			code: event.target.code
		});
	};

	TestCasesPane.prototype.previousExecutionsAddButtonClicked = function(event, index) {
		this._insertNewTestcase({
			title: event.target.title,
			code: event.target.codeForSuggestionIndex(index)
		});
	};

	TestCasesPane.prototype._insertNewTestcase = function(testCase) {
		var newWidget = new TestCaseWidget(this.testCaseCollection.addTestCaseToSuite(testCase, this.testSuiteId));
		newWidget.inSuite = true;
		$(newWidget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);

		var widgetsForSuite = this.widgetsBySuite[this.testSuiteId];
		newWidget.insertBefore(this.$pane.find(".ti-roundAddButton"));

		widgetsForSuite.splice(-1, 0, newWidget);
		
		if (event !== undefined) {
			event.stopPropagation();
		}
	};

	TestCasesPane.prototype.documentSaved = function(event, doc) {
		if (DocumentManager.getCurrentDocument() === doc) { 
			this.updateTestCases();
			this.testCaseCollection.save().done(function () {
				// if (this.testSuiteId) {
				// 	this.testSuite = this.testCaseCollection.getTestSuiteForId(this.testSuiteId);
				// }
				// this._update();
			}.bind(this));
		}
	};

	TestCasesPane.prototype.updateTestCases = function() {
		_.forEach(this.widgetsBySuite, function (widgetsForSuite, suiteId) {
			var testSuite = {
				id: 	suiteId,
				title:  this.suiteBySuiteId[suiteId].title,
				testCaseCollection: this.suiteBySuiteId[suiteId].testCaseCollection,
				tests: 	_(widgetsForSuite).filter(function (widget) {
							return ("testCase" in widget);
						}).map(function(widget) {
							return widget.testCase;
						}).value(),
				beforeAll: {},
				beforeEach: {},
				afterEach: {}
			};

			var beforeAllWidget = _.find(widgetsForSuite, { mode: "beforeAll" });
			var beforeEachWidget = _.find(widgetsForSuite, { mode: "before" });
			var afterEachWidget = _.find(widgetsForSuite, { mode: "after" });

			testSuite.beforeAll.code = beforeAllWidget !== undefined ? beforeAllWidget.code : "";
			testSuite.beforeEach.code = beforeEachWidget !== undefined ? beforeEachWidget.code : "";
			testSuite.afterEach.code = afterEachWidget !== undefined ? afterEachWidget.code : "";

			testSuite.testCaseCollection.updateTestSuite(testSuite);
		}.bind(this));
	};

	TestCasesPane.prototype.currentDocumentChanged = function(event, newDocument) {
		newDocument = DocumentManager.getCurrentDocument();
		if (newDocument && ((this._collectionSelector.value === undefined) || (this._collectionSelector.value === "autogenerated"))) {
			this.testCaseCollection = TestCaseCollectionManager.getGeneratedTestCaseCollectionForPath(newDocument.file.fullPath);
			this.testCaseCollection.loadingPromise.done(this._update);
		}
		this.currentFullEditor = EditorManager.getCurrentFullEditor(); 
	};

	TestCasesPane.prototype.cursorMoved = function(event) {
		var pos = this.currentFullEditor.getCursorPos();
		var functionInfo = this.currentFullEditor.document.functionTracker.functionInfoAtLocationInDocument(pos); 
		var newFunctionIdentifier;
		if (functionInfo) {
			newFunctionIdentifier = functionInfo.functionIdentifier;
		}
		if (this.functionIdentifier !== newFunctionIdentifier) {
			this.functionIdentifier = newFunctionIdentifier;
			if (this.isAutomaticSuiteSelectionEnabled) {
				this.testCaseCollection.loadingPromise.done(function () {
					if (this.functionIdentifier !== undefined) {
						this.testSuite = this.testCaseCollection.getTestSuiteForId(this.functionIdentifier);
					} else {
						this.testSuite = undefined;
					}
					this._update();
				}.bind(this));
			}
		}
	};

	TestCasesPane.prototype._onCollectionSelectorChange = function() {
		if ((this._collectionSelector.value === undefined) || (this._collectionSelector.value === "autogenerated")) {
			var currentDocument = DocumentManager.getCurrentDocument(); 
			if (currentDocument) {
				this.testCaseCollection = TestCaseCollectionManager.getGeneratedTestCaseCollectionForPath(DocumentManager.getCurrentDocument().file.fullPath);
				if (this.functionIdentifier !== undefined) {
					this.testSuite = this.testCaseCollection.getTestSuiteForId(this.functionIdentifier);
				} else {
					this.testSuite = undefined;
				}
			} else {
				this.testCaseCollection = undefined;
				this.testSuite = undefined;
			}
		} else if (this.mode === TestCasesPaneMode.suite) {
			this.testCaseCollection = TestCaseCollectionManager.getUserTestCaseCollectionForName(this._collectionSelector.value);
			if (this.testSuiteId !== undefined) {
				this.testSuite = this.testCaseCollection.getTestSuiteForId(this.testSuiteId);	
			} else {
				this.testSuite = undefined;
			}
			
		} else {
			this._update();
		}
	};

	TestCasesPane.prototype._onCollectionSelectorAdd = function() {
		this.testCaseCollection = TestCaseCollectionManager.getUserTestCaseCollectionForName(this._collectionSelector.value);
	};

	TestCasesPane.prototype._onSuiteSelectorChange = function() {
		this.updateTestCases();

		if (this.testSuiteId !== undefined) {
			this.testSuite = this.testCaseCollection.getTestSuiteForId(this.testSuiteId, this._suiteSelector.value);
			if (this.testSuite.id !== this.testSuiteId) {
				this._updateTestSuiteList();
			}
		} else {
			this.testSuite = undefined;
		}

		this._update();
	};

	TestCasesPane.prototype.cursorShouldMoveToOtherWidget = function(event, direction) {
		var emittingWidgetIndex = -1; 
		var emittingSuiteName;
		var emittingWidgetSuite = _.find(this.widgetsBySuite, function (widgetArray, suiteName) {
			emittingWidgetIndex = widgetArray.indexOf(event.target);
			if (emittingWidgetIndex > -1) {
				emittingSuiteName = suiteName;
				return true;
			} else {
				return false;
			}
		});
		
		if (emittingWidgetIndex === -1) {
			TIUtils.log("cursorShouldMoveToOtherWidget event received from untracked widget");
			return; 
		}

		var nextWidget;
		var suites = _.keys(this.widgetsBySuite);
		var emittingSuiteIndex = suites.indexOf(emittingSuiteName);
		var nextSuite;

		if ((emittingWidgetIndex === 0) && 
			(emittingSuiteIndex !== 0) && 
			(direction === "up")) {

			nextSuite = this.widgetsBySuite[suites[emittingSuiteIndex - 1]]; 
			nextWidget = _.last(nextSuite);

		} else if (	(emittingWidgetIndex === emittingWidgetSuite.length - 1) && 
					(emittingSuiteIndex !== suites.length - 1) && 
					(direction === "down")) {

			nextSuite = this.widgetsBySuite[suites[emittingSuiteIndex + 1]];
			nextWidget = _.first(nextSuite);

		} else {
			var nextWidgetIndex = (direction === "up") ? emittingWidgetIndex - 1 : emittingWidgetIndex + 1; 
			nextWidget = emittingWidgetSuite[nextWidgetIndex];	
		}
		
		if ((nextWidget !== undefined) && (nextWidget.focus !== undefined)) {
			nextWidget.focus(direction);
		}
	};

	TestCasesPane.prototype._onUpdatedTestResults = function() {
		this.$errorView.hide();
		if (this.mode === TestCasesPaneMode.individual) {
			this._update();
		}
	};

	TestCasesPane.prototype._onUpdatedTestError = function(event, errorMessage) {
		if (errorMessage === "") {
			this.$errorView.hide(); 
		} else {
			errorMessage = errorMessage.replace(/\n/g,"<br />");

			this.$errorView.html(errorMessage); 
			this.$errorView.show();
		}
	};

	TestCasesPane.prototype._onUpdatedTestCollections = function() {
		this._updateTestCollectionList(); 
	};
	
	TestCasesPane.prototype._updateTestCollectionList = function () {
		this.updateTestCases();

		var collections = TestCaseCollectionManager.getUserTestCaseCollections();
		var content = _.map(collections, function (collectionName) {
			return {
				text: collectionName,
				value: collectionName
			};
		});

		content.unshift({
			text: "Test Cases calling current function",
			value: TestCasesPaneMode.individual
		});

		content.unshift({
			text: "Autogenerated Suites for Current Document",
			value: "autogenerated"
		});

		this._collectionSelector.content = content;

		this._updateTestSuiteList();
	};
	
	TestCasesPane.prototype._updateTestSuiteList = function () {
		if (this.testCaseCollection) {
			this.testCaseCollection.loadingPromise.done(function () {
				var suiteTitles = this.testCaseCollection.getTestSuiteTitlesById(); 
				var content = _.map(suiteTitles, function (suiteTitle, suiteId) {
					return {
						text: suiteTitle, 
						value: suiteId
					};
				});

				if (this._collectionSelector.value === "autogenerated") {
					content.unshift({
						text: "Current Function", 
						value: "auto"
					});
				}

				this._suiteSelector.allowAdd = (this._collectionSelector.value !== "autogenerated");
				this._suiteSelector.content = content;	
			}.bind(this));
		}
	};

	TestCasesPane.prototype._clear = function() {
		_.each(this.widgetsBySuite, function (widgetArray) {
			_.each(widgetArray, function (widget) {
				widget.remove();	
			});			
		}); 

		_.each(this.suggestionWidgets, function (widget) {
			widget.remove();
		});

		if (this.previousExecutionsWidget) {
			this.previousExecutionsWidget.remove(); 
			this.previousExecutionsWidget = undefined;
		}

		this.widgetsBySuite = {};
		this.suiteBySuiteId = {};
		this.suggestionWidgets = [];

		this.$scrollView.find(".ti-testSection").remove();
		this.$scrollView.find(".ti-roundAddButton").remove();
		this.$scrollView.find(".ti-addArea").remove();
	};

	TestCasesPane.prototype._update = function() {
		// this.updateTestCases();
		this._clear();
		
		if (this.testSuite === undefined) {
			return;
		}

		var widgetsForCurrentSuite = [];
		this.suiteBySuiteId[this.testSuite.id] = this.testSuite;
		this.widgetsBySuite[this.testSuite.id] = widgetsForCurrentSuite;	

		var isModeSuite = (this.mode === TestCasesPaneMode.suite);

		if (isModeSuite) {
			this._updateSuiteStart(widgetsForCurrentSuite);
		}

		this._updateTests(widgetsForCurrentSuite);

		if (isModeSuite) {
			this._updateAddArea();
			this._updateSuiteEnd(widgetsForCurrentSuite);
		}
	};

	TestCasesPane.prototype._updateSuiteStart = function(widgetsOutArray) {
		var widget = new BeforeAfterWidget(this.testSuite.beforeAll.code, "beforeAll");
		$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
		widget.appendTo(this.$scrollView);
		widgetsOutArray.push(widget);

		widget = new BeforeAfterWidget(this.testSuite.beforeEach.code, "before");
		$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
		widget.appendTo(this.$scrollView);
		widgetsOutArray.push(widget);
	};

	TestCasesPane.prototype._updateSuiteEnd = function(widgetsOutArray) {
		var widget = new BeforeAfterWidget(this.testSuite.afterEach.code, "after");
		$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
		widget.appendTo(this.$scrollView);
		widgetsOutArray.push(widget);
	};

	TestCasesPane.prototype._updateTests = function(widgetsOutArray) {
		var testCases = [];
		var areAllFromSameSuite = (this.mode === TestCasesPaneMode.suite);

		if (areAllFromSameSuite && this.testSuite && this.testSuite.tests) {
			testCases = this.testSuite.tests;
		} else if (this.mode === TestCasesPaneMode.individual) {
			testCases = TestCaseCollectionManager.getTestCasesCallingFunction(this.functionIdentifier);
		}

		var currentSuiteName;

		for (var i = 0; i < testCases.length; i++) {
			var testCase = testCases[i];
			if ((! areAllFromSameSuite) && (currentSuiteName !== testCase.suiteName)) {
				currentSuiteName = testCase.suiteName; 
				this._createSectionHeaderWithTitleAndText(currentSuiteName).appendTo(this.$scrollView);
			}
			var widget = new TestCaseWidget(testCase); 
			widget.inSuite = areAllFromSameSuite;
			$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
			widget.appendTo(this.$scrollView); 
			widgetsOutArray.push(widget);
		}
	};

	TestCasesPane.prototype._updateAddArea = function() {
		$("<div />").addClass('ti-roundAddButton').append(
			$("<span />").text("Add Test")
		).appendTo(this.$scrollView).on("click", this.addTestButtonClicked);

		if (this._collectionSelector.value === "autogenerated") {
			var $addArea = $("<div />").addClass("ti-addArea").hide(); 

			$("<a />").addClass("ti-closeButton").on("click", this.closeAddAreaClicked).appendTo($addArea);

			this._createSectionHeaderWithTitleAndText("Add Test Case").appendTo($addArea);

			this.suggestionWidgets = []; 

			var widget = new TemplateWidget("function () {\n\n}");
			widget.title = "Empty TestCase"; 
			$(widget).on("addButtonClicked", this.templateAddButtonClicked);
			widget.appendTo($addArea);
			this.suggestionWidgets.push(widget);

			this._createSectionHeaderWithTitleAndText("From Last Execution", 
				"The template below can be autofilled with values from calls to the function traced by Theseus. The test can be fully customized after adding it to the test suite.")
				.appendTo($addArea);

			widget = new PreviousExecutionsWidget(this.functionIdentifier);
			$(widget).on("addButtonClicked", this.previousExecutionsAddButtonClicked); 
			widget.appendTo($addArea);
			this.previousExecutionsWidget = widget;

			TestCaseSuggestionGenerator.getTestSuggestionsForFunctionIdentifier(this.functionIdentifier).done(function (testCaseSuggestions) {
				if (testCaseSuggestions.length > 0) {
					this._createSectionHeaderWithTitleAndText("Suggestions",
						"These templates can be prefilled with typical test data for your types and fully customized after adding them to the test suite.")
						.appendTo($addArea);
				}	

				for (var i = 0; i < testCaseSuggestions.length; i++) {
					var suggestion = testCaseSuggestions[i];
					widget = new TemplateWidget(suggestion.templateString, suggestion.argumentSuggestions); 
					widget.title = suggestion.title;
					$(widget).on("addButtonClicked", this.templateAddButtonClicked);
					widget.appendTo($addArea);
					this.suggestionWidgets.push(widget);
				}
			}.bind(this));

			$addArea.appendTo(this.$scrollView);
		}
	};

	TestCasesPane.prototype._createSectionHeaderWithTitleAndText = function(title, text) {
		var $result = $("<div />").addClass('ti-testSection').append($("<h2 />").text(title));
		if ((text !== undefined) && (text.length > 0)) {
			$result.append($("<span />").text(text));
		}

		return $result;
	};

	module.exports = TestCasesPane;  
});