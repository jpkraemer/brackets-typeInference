/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var AppInit						= brackets.getModule("utils/AppInit");
	var DocumentationInlineEditor 	= require("./src/DocumentationInlineEditor");
	var DocumentManger				= brackets.getModule("document/DocumentManager");
	var EditorManager				= brackets.getModule("editor/EditorManager");
	var ExtensionUtils				= brackets.getModule("utils/ExtensionUtils");
	var JSDocTypeProvider			= require("./src/JSDocTypeProvider");
	var JSUtils						= brackets.getModule("language/JSUtils");
	var TheseusTypeProvider 		= require("./src/TheseusTypeProvider");
	var TypeInformationStore 		= require("./src/TypeInformationStore"); 
	var TIUtils 					= require("./src/TIUtils");

	function _init () {
		TIUtils.log("loading... "); 

		ExtensionUtils.loadStyleSheet(module, "main.less");

		TypeInformationStore.init();
		TheseusTypeProvider.init();
		JSDocTypeProvider.init();

		$(DocumentManger).on("currentDocumentChange", _currentDocumentChange);
		_currentDocumentChange(null, DocumentManger.getCurrentDocument());
	}

	function _currentDocumentChange (evt, currentDocument, previousDocument) {
		var typeInformationRetrievedHandler = function (startPos, endPos, docs) {
			if (docs.length === 0) {
				return;
			} else {
				var typeInformation = docs[0];
				var startBookmark = hostEditor._codeMirror.setBookmark(startPos);
				var endBookmark = hostEditor._codeMirror.setBookmark(endPos);

				var documentationInlineEditor = new DocumentationInlineEditor(typeInformation.functionIdentifier, startBookmark, endBookmark);
				documentationInlineEditor.load(hostEditor);
				documentationInlineEditor.setContent(typeInformation);

				hostEditor.addInlineWidget({ line: startPos.line - 1, ch: 0 }, documentationInlineEditor, true);		
			}
		};

		var hostEditor = EditorManager.getCurrentFullEditor();

		if (currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

		var functionsInFile = JSUtils.findAllMatchingFunctionsInText(currentDocument.getText(), "*");

		for (var i = functionsInFile.length - 1; i >= 0; i--) {
			var functionSpec = functionsInFile[i];
			
			var startPos 	= { line: functionSpec.lineStart },
				endPos		= { line: functionSpec.lineEnd };
			var startLine 	= currentDocument.getLine(startPos.line),
				endLine		= currentDocument.getLine(endPos.line);

			var matches = startLine.match(/function/); 
			if (matches) {
				startPos.ch = matches.index;
			}

			matches = undefined;
			matches = endLine.match(/\}/);
			if (matches) {
				endPos.ch = matches.index + 1;
			}

			var functionIdentifier = currentDocument.file.fullPath + "-function-" + 
										(startPos.line + 1) + "-" + 
										startPos.ch + "-" +
										(endPos.line + 1) + "-" +
										endPos.ch;

			var documentationInlineEditor = new DocumentationInlineEditor(functionIdentifier, hostEditor, startPos, endPos);			
		}
	}

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});