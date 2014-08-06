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

		TypeInformationStore.functionIdentifiersForFile(currentDocument.file.fullPath).done(function (functionIdentifiers) {
			var fullText = currentDocument.getText(); 
			var lines = fullText.split("\n");
			var regex = /@uniqueFunctionIdentifier (\S+)/; 

			for (var i = 0; i < lines.length; i++) {
				var line = lines[i];
				var match = regex.exec(line);
				if (match && (functionIdentifiers.indexOf(match[1]) !== -1)) {
					var functionIdentifier = match[1];

					var startPos = {}; 
					var endPos = {}; 

					startPos.line = 0; 
					var j = i - 1; 
					while ((j >= 0) && (startPos.line === 0)) {
						if (/^\s*\/\*\*/.test(lines[j])) {
							startPos.line = j;
							startPos.ch = lines[j].match(/^\s*/)[0].length;
						}
						j--;
					}

					endPos.line = 0; 
					j = j + 1; 
					while ((j < lines.length) && (endPos.line === 0)) {
						if (/^\s*\*\//.test(lines[j])) {
							endPos.line = j;
							endPos.ch = lines[j].match(/^\s*\*\//)[0].length;
						} 
						j++;
					}	

					var documentationInlineEditor = new DocumentationInlineEditor(functionIdentifier, hostEditor, startPos, endPos);
				}
			}
		});
	}

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});