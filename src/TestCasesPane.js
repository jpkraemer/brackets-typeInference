 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Resizer 			= brackets.getModule("utils/Resizer");
	var CodeMirror 			= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var DocumentManager 	= brackets.getModule("document/DocumentManager"); 
	var EditorManager		= brackets.getModule("editor/EditorManager");
	var FunctionTracker		= require("./FunctionTracker");
	var TestCasesProvider	= require("./TestCasesProvider");
	var TestCaseWidget		= require("./TestCaseWidget");
	
	var EVENT_NAMESPACE = ".TestCasesPane"; 

	function TestCasesPane () {
		_.bindAll(this);

		this.widgets = [];

		$(DocumentManager).on("currentDocumentChange", this.currentDocumentChanged); 
		this.currentDocumentChanged(null, DocumentManager.getCurrentDocument());

		$(DocumentManager).on("documentSaved", this.documentSaved);

		$(TestCasesProvider).on("didLoadTestsForCurrentDocument", this._update);

		this.$pane = $(require("text!./templates/TestCasesPane.html"));
		this.$scollView = this.$pane.find('.ti-scrollView');
		Resizer.makeResizable(this.$pane.get(0), Resizer.DIRECTION_HORIZONTAL, "left");

		this.$pane.find('.ti-roundAddButton').on('click', this.addTestButtonClicked); 

		this.$pane.insertBefore('#editor-holder > .CodeMirror');
		$('#editor-holder > .CodeMirror').width("50%");
	}

	TestCasesPane.prototype.constructor = TestCasesPane; 

	TestCasesPane.prototype.$pane = undefined;
	TestCasesPane.prototype.$scollView = undefined;
	TestCasesPane.prototype.codeMirror = undefined;
	TestCasesPane.prototype.currentFullEditor = undefined;
	TestCasesPane.prototype.functionIdentifier = undefined;
	TestCasesPane.prototype.widgets = undefined;

	TestCasesPane.prototype.addTestButtonClicked = function(event) {
		var newWidget = new TestCaseWidget(TestCasesProvider.addTestCaseForPath({
			functionIdentifier: this.functionIdentifier,
			title: "This is a test case", 
			code: "function () {\n\n}",
			isSuggestion: false
		}, this.currentFullEditor.document.file.fullPath));

		newWidget.insertBefore(this.$pane.find('.ti-roundAddButton'));
		
		if (event !== undefined) {
			event.stopPropagation();
		}
	};

	TestCasesPane.prototype.documentSaved = function(event, doc) {
		if (DocumentManager.getCurrentDocument() === doc) {
			TestCasesProvider.updateTestCase(_.map(this.widgets, function(widget) {
				return widget.testCase;
			}));
		}
	};

	TestCasesPane.prototype.currentDocumentChanged = function(event, newDocument) {
		var newFullEditor = EditorManager.getCurrentFullEditor(); 

		if (this.currentFullEditor !== newFullEditor) {
			if (this.currentFullEditor !== undefined) {
				$(this.currentFullEditor).off(EVENT_NAMESPACE);
			}

			this.currentFullEditor = newFullEditor; 
			$(this.currentFullEditor).on("cursorActivity" + EVENT_NAMESPACE, this.cursorMoved);
			this.cursorMoved();
		}
	};

	TestCasesPane.prototype.cursorMoved = function(event) {
		var pos = this.currentFullEditor.getCursorPos();
		var newFunctionIdentifier = FunctionTracker.functionIdAtLocationInDocument(pos, this.currentFullEditor.document);
		if (this.functionIdentifier !== newFunctionIdentifier) {
			this.functionIdentifier = newFunctionIdentifier;
			this._update(); 
		}
	};

	TestCasesPane.prototype._update = function() {
		_.each(this.widgets, function (widget) {
			widget.remove();
		}); 
		this.widgets = [];

		var testSuite = TestCasesProvider.getTestCasesForFunctionIdentifier(this.functionIdentifier);
		var testCases = [];
		if (testSuite && testSuite.tests) {
			testCases = testSuite.tests;
		}
		for (var i = 0; i < testCases.length; i++) {
			var testCase = testCases[i];
			var widget = new TestCaseWidget(testCase); 
			widget.insertBefore(this.$pane.find('.ti-roundAddButton')); 
			this.widgets.push(widget);
		}
	};

	module.exports = TestCasesPane;  
});