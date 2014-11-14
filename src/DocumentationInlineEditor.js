/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _                              = require("./lib/lodash");
	var AnimationUtils                 = brackets.getModule("utils/AnimationUtils");
	var Async                          = brackets.getModule("utils/Async");
	var CodeMirror                     = brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var Editor                         = brackets.getModule("editor/Editor").Editor;
	var InlineWidget 			       = brackets.getModule("editor/InlineWidget").InlineWidget;
	var TheseusAgentWrapper            = require("./TheseusAgentWrapper");
	var TheseusTypeProvider            = require("./TheseusTypeProvider");
	var TypeInformationHTMLRenderer    = require("./TypeInformationHTMLRenderer");
	var TIUtils                        = require("./TIUtils");

	var DOC_PART_ORDER                 = ["description", "parameters", "return"];

	/**
	 * We add functionality to render inline widgets above the inserted line here. 
	 * Therefor, we copy the original addInlineWidget methods from the editor and change them to use the above: true option.
	 * It is a terrible hack and should be avoided in the future.
	 */
	Editor.prototype.addInlineWidgetAbove = function (pos, inlineWidget, scrollLineIntoView) {
		var self = this,
			queue = this._inlineWidgetQueues[pos.line],
			deferred = new $.Deferred();
		if (!queue) {
			queue = new Async.PromiseQueue();
			this._inlineWidgetQueues[pos.line] = queue;
		}
		queue.add(function () {
			self._addInlineWidgetAboveInternal(pos, inlineWidget, scrollLineIntoView, deferred);
			return deferred.promise();
		});
		return deferred.promise();
	};
	
	/**
	 * @private
	 * Does the actual work of addInlineWidget().
	 */
	Editor.prototype._addInlineWidgetAboveInternal = function (pos, inlineWidget, scrollLineIntoView, deferred) {
		var self = this;
		
		this.removeAllInlineWidgetsForLine(pos.line).done(function () {
			if (scrollLineIntoView === undefined) {
				scrollLineIntoView = true;
			}
	
			if (scrollLineIntoView) {
				self._codeMirror.scrollIntoView(pos);
			}
	
			inlineWidget.info = self._codeMirror.addLineWidget(pos.line, inlineWidget.htmlContent,
															   { coverGutter: true, noHScroll: true, above: true });
			CodeMirror.on(inlineWidget.info.line, "delete", function () {
				self._removeInlineWidgetInternal(inlineWidget);
			});
			self._inlineWidgets.push(inlineWidget);

			// Set up the widget to start closed, then animate open when its initial height is set.
			inlineWidget.$htmlContent.height(0);
			AnimationUtils.animateUsingClass(inlineWidget.htmlContent, "animating")
				.done(function () {
					deferred.resolve();
				});

			// Callback to widget once parented to the editor. The widget should call back to
			// setInlineWidgetHeight() in order to set its initial height and animate open.
			inlineWidget.onAdded();
		});
	};

	/**
	 * @constructor
	 * @param {String} functionIdentifier The permanent identifier for the function whose documentation is rendered
	 * @param {Editor} hostEditor 
	 * @param {{line: number, ch: number}} startBookmark start of the comment in the source code. 
	 * @param {{line: number, ch: number}} endBookmark end of the comment in the source code
	 */
	function DocumentationInlineEditor (functionIdentifier, hostEditor, startPos, endPos) {
		this.functionIdentifier        = functionIdentifier;
		this._startBookmark 	       = hostEditor._codeMirror.setBookmark(startPos); 
		this._endBookmark 		       = hostEditor._codeMirror.setBookmark(endPos);
		this._bookmarksForInvocationId = {};

		InlineWidget.call(this);
		_.bindAll(this);

		this.$htmlContent.empty();
		this.$htmlContent.off();

		this.load(hostEditor);
		this.typeInformation = hostEditor.document.typeInformationCollection.typeInformationForFunctionIdentifier(this.functionIdentifier);

		hostEditor.addInlineWidgetAbove({ line: endPos.line + 1, ch: 0 }, this, true);
		this._textMarker = hostEditor._hideLines(startPos.line, endPos.line + 1);
	}

	DocumentationInlineEditor.prototype = Object.create(InlineWidget.prototype);
	DocumentationInlineEditor.prototype.constructor = DocumentationInlineEditor;
	DocumentationInlineEditor.prototype.parentClass = InlineWidget.prototype;

	/**
	 * Start of the range of code we're attached to; _startBookmark.find() may by null if sync is lost.
	 * @type {!CodeMirror.Bookmark}
	 */
	DocumentationInlineEditor.prototype._startBookmark = null;
	
	/**
	 * End of the range of code we're attached to; _endBookmark.find() may by null if sync is lost or even
	 * in some cases when it's not. Call getCurrentRange() for the definitive text range we're attached to.
	 * @type {!CodeMirror.Bookmark}
	 */
	DocumentationInlineEditor.prototype._endBookmark = null;

	/**
	 * A CodeMirror.TextMarker representing the hidden portion of the source code
	 * @type {!CodeMirror.TextMarker}
	 */
	DocumentationInlineEditor.prototype._textMarker = null;

	/**
	 * A div to hold the actual content of the widget
	 * @type {jQueryObject}
	 */
	DocumentationInlineEditor.prototype.$contentDiv = null;

	/**
	 * The function identifier for which this widget displays information
	 * @type {String}
	 */
	DocumentationInlineEditor.prototype.functionIdentifier = null;

	/**
	 * The currently displayed type information
	 * @type {TypeInformation}
	 */
	DocumentationInlineEditor.prototype._typeInformation = null;

	/**
	 * The current editor displayed to show part of the documentation. This iVar must not be called editor, because the QuickView
	 * extension accesses editors from all inline widgets and crashes.
	 * @type {CodeMirror}
	 */
	DocumentationInlineEditor.prototype.inlineEditor = null;

	/**
	 * The docPartSpecifier currently displayed in the editor
	 * @type {{partType: string, id: number}}
	 */
	DocumentationInlineEditor.prototype.docPartSpecifier = undefined;

	/**
	 * A map storing bookmarks for Theseus invocations 
	 * @type {invocationId: {start: bookmark, end: bookmark}}
	 */
	DocumentationInlineEditor.prototype._bookmarksForInvocationId = undefined;

	Object.defineProperties(DocumentationInlineEditor.prototype, {
		"typeInformation": {
			get: function () { return this._typeInformation; },
			set: function (newValue) { 
				if (this._typeInformation !== newValue) {
					$(this._typeInformation).off("change"); 
					this._typeInformation = newValue;
					$(this._typeInformation).on("change", this._typeInformationDidChange);

					this._render();
				}
			}
		}
	});

	/**
	 * This method clears all bookmarks and then empties the dictionary storing call locations
	 */
	DocumentationInlineEditor.prototype._clearBookmarksForInvocationId = function() {
		_.forOwn(this._bookmarksForInvocationId, function (locationInfo, key) {
			if (locationInfo.startBookmark) {
				locationInfo.startBookmark.clear();
			}

			if (locationInfo.endBookmark) {
				locationInfo.endBookmark.clear();
			}
		});

		this._bookmarksForInvocationId = {};
	};

	/**
	 * This method adds the location information for a given theseus invocation id to the dictionary
	 */
	DocumentationInlineEditor.prototype._cacheLocationForInvocationId = function(theseusInvocationId) {
		TheseusAgentWrapper.callingInvocationForFunctionInvocation(theseusInvocationId).done(function (caller) {
			var filePath = caller.nodeId.split("-").slice(0,-5).join("-");

			var locationInfo = {
				start: caller.range.start,
				end: caller.range.end,
				filePath: filePath
			};

			if (filePath === this.hostEditor.document.file.fullPath) {
				locationInfo.startBookmark = this.hostEditor._codeMirror.setBookmark(locationInfo.start);
				locationInfo.endBookmark = this.hostEditor._codeMirror.setBookmark(locationInfo.end);
			}

			this._bookmarksForInvocationId[theseusInvocationId] = locationInfo;
		}.bind(this)).fail(function (err) {
			TIUtils.log(err);
		});
	};

	/**
	 * Returns the current text range of the color we're attached to, or null if
	 * we've lost sync with what's in the code.
	 * @return {?{start:{line:number, ch:number}, end:{line:number, ch:number}}}
	 */
	DocumentationInlineEditor.prototype.getCurrentRange = function () {
		var currentRange = this._textMarker.find();
		return { start: currentRange.from, end: currentRange.to };
	};

	/**
	 * @override
	 * @param {!Editor} hostEditor
	 */
	DocumentationInlineEditor.prototype.load = function (hostEditor) {
		DocumentationInlineEditor.prototype.parentClass.load.apply(this, arguments);

		this.$contentDiv = $("<div />")
								.addClass("ti-documentation-container")
								.css("margin-left", $(hostEditor._codeMirror.display.gutters).width());
		this.$contentDiv.on("click", this._clickHandler);
		this.$htmlContent.append(this.$contentDiv);
	};

	/**
	 * @override
	 * Perform sizing & focus once we've been added to Editor's DOM
	 */
	DocumentationInlineEditor.prototype.onAdded = function () {
		DocumentationInlineEditor.prototype.parentClass.onAdded.apply(this, arguments);

		this._recalculateHeight();
	};

	/**
	 * Callback for new type information from the TypeStore 
	 * @param  {jQueryEvent} evt
	 * @param  {TypeInformation} newDoc
	 */
	DocumentationInlineEditor.prototype._typeInformationDidChange = function(evt) {
		this._render();
	};

	/**
	 * Move the cursor into the editor
	 * @param  {boolean} fromBelow If set to true, the last line will be edited, otherwise the first
	 */
	DocumentationInlineEditor.prototype.focus = function(fromBelow) {
		if (fromBelow === undefined) {
			fromBelow = false;
		}

		if (fromBelow) {
			this.docPartSpecifier = { partType: _.last(this._availableDocPartTypes()) };
		} else {
			this.docPartSpecifier = { partType: _.first(this._availableDocPartTypes()) };
		}

		if (this.docPartSpecifier.partType === "parameters") {
			this.docPartSpecifier.id = (fromBelow) ? this.typeInformation.argumentTypes.length - 1 : 0;
		}

		this._render();
	};

	/**
	 * This method rerenders the content of the widget
	 */
	 DocumentationInlineEditor.prototype._render = function() {
		var $line;
		var pendingChanges; 

		var insertPendingChange = function (typeInformation, $line, argumentTypeId) {
			if (argumentTypeId === undefined) {
				argumentTypeId = -1;
			}

			if ((typeInformation.conflicts !== undefined) && (! _.isEmpty(typeInformation.conflicts))) {
				var $pendingChangesTable = $(TypeInformationHTMLRenderer.pendingChangesToHTML(typeInformation.conflicts, typeInformation.mergedConflicts(), true));
				$pendingChangesTable.hide();

				var $mergeButton = $pendingChangesTable.find("tr:eq(1) a");
				$mergeButton.on("click", this._markCorrectClickHandler.bind(this, argumentTypeId, "merge")); 

				var $individualRows = $pendingChangesTable.find("tr:gt(2)");
				$individualRows.each(function (index, element) {
					var $row = $(element); 
					var theseusInvocationId = $row.data("theseusinvocationid");

					this._cacheLocationForInvocationId(theseusInvocationId);

					$mergeButton = $row.find("a:first"); 
					$mergeButton.on("click", this._markCorrectClickHandler.bind(this, argumentTypeId, theseusInvocationId));

					var $jumpToCallButton = $row.find("a:last");
					$jumpToCallButton.on("click", this._showCallLocationClickHandler.bind(this, theseusInvocationId));
				}.bind(this));

				var $openChangesButton = $("<a />").addClass('ti-button').text("Type changed"); 
				$openChangesButton.addClass('ti-alert');
				$openChangesButton.on("click", function (event) {
					$pendingChangesTable.toggle();
					setTimeout(function () {
						var $cells = $pendingChangesTable.find(".ti-property-type");
						var maxWidth = _.max($cells.map(function() {
							return $(this).outerWidth(); 
						}).get());

						this._recalculateHeight();
					}.bind(this), 1);

					event.stopPropagation();
				}.bind(this));

				$line.find("tr").append($openChangesButton);
				$line.append($pendingChangesTable);
			}
		}.bind(this);

		this._closeEditor();
		this.$contentDiv.empty();
		this._clearBookmarksForInvocationId();

		var $descriptionContainer = $("<div />").addClass("ti-description"); 
		if (this.typeInformation.description) { 
			this.$contentDiv.append($("<h2 />").append("Description").addClass("ti-headline"));
			$descriptionContainer.append(TypeInformationHTMLRenderer.markdownStringToHTML(this.typeInformation.description));
			$descriptionContainer.on("click", this._clickHandler);
		}
		this.$contentDiv.append($descriptionContainer);

		if (this.typeInformation.argumentTypes && (this.typeInformation.argumentTypes.length > 0)) {
			this.$contentDiv.append($("<h2 />").append("Parameters").addClass("ti-headline"));

			for (var i = 0; i < this.typeInformation.argumentTypes.length; i++) {
				var typeInformation = this.typeInformation.argumentTypes[i]; 
				$line = $(TypeInformationHTMLRenderer.typeToHTML(typeInformation, true));
				if (_.size(typeInformation.conflicts) > 0) {
					insertPendingChange(typeInformation, $line, i);
				}
				$line.data("argumentId", i);
				$line.on("click", this._clickHandler);
				this.$contentDiv.append($line); 
			}
		}

		if (this.typeInformation.returnType) {
			$line = $(TypeInformationHTMLRenderer.typeToHTML(this.typeInformation.returnType, false));
			$line.addClass('ti-return');
			if (_.size(this.typeInformation.returnType.conflicts) > 0) {
				insertPendingChange(this.typeInformation.returnType, $line, undefined);
			}

			$line.on("click", this._clickHandler);
			this.$contentDiv.append($line);
		}

		this._displayEditorForPartOfTypeInfo();

		var cellsToAlign =  [ this.$contentDiv.find(".ti-property-type").not(".table .ti-property-type"), 
							  this.$contentDiv.find(".ti-property-name") ];
		setTimeout(function () {
			_.forEach(cellsToAlign, function ($cells) {
				var maxWidth = _.max($cells.map(function() {
					return $(this).outerWidth(); 
				}).get());
				//maxwidth should automatically include max-width set in css
				$cells.outerWidth(maxWidth);
			});

			this._recalculateHeight(); 
		}.bind(this), 1);
   };

	/**
	 * Updates the height of the inline widget if needed
	 */
	DocumentationInlineEditor.prototype._recalculateHeight = function() {
		this.hostEditor.setInlineWidgetHeight(this, Math.max(this.$contentDiv.height() + 10, 38), true);
	};

	/**
	 * The click handler for all the "Add to JSDoc" links. Basically this is called when someone manually adds a pending change
	 * to the type information. It will update the type information in the store and try to merge all other pending changes. 
	 * Pending changes are deleted and will only come back if merging fails again after adding one of the pending changes.
	 * @param  {number} argumentTypeId    Index in the argument array or -1 for returnType. Preset via bind, not from event
	 * @param  {string} pendingChangesKey Key for the pending changes hash. Can be a theseus invocation ID or "merge". Preset via bind
	 * @param  {object} event             The event
	 */
	DocumentationInlineEditor.prototype._markCorrectClickHandler = function(argumentTypeId, pendingChangesKey, event) {
		var type;
		if (argumentTypeId > -1) {
			//we have an argument change
			type = this.typeInformation.argumentTypes[argumentTypeId];
		} else {
			type = this.typeInformation.returnType;
		}

		if (pendingChangesKey === "merge") {
			type.resolveWithConflict(type.mergedConflicts());
		} else {
			type.resolveWithConflict(type.conflicts[pendingChangesKey]);
		}

		this._render();

		event.stopPropagation();
   };

   /**
	* Click handler for the "jump to call" links. Will scroll the callsite into view and briefly highlight the line.
	* @param  {string} theseusInvocationId Theseus invocation id for the call. Preset via bind
	* @param  {object} event               
	*/
   DocumentationInlineEditor.prototype._showCallLocationClickHandler = function(theseusInvocationId, event) {
		var locationInfo = this._bookmarksForInvocationId[theseusInvocationId];
		if (locationInfo !== undefined) {
			var location; 
			if (locationInfo.endBookmark !== undefined) {
				location = locationInfo.endBookmark.find();
			} else {
				location = locationInfo.end;
			}

			this.hostEditor.setCursorPos(location.line - 1, location.ch, true);
			this.hostEditor.focus();

			this.hostEditor._codeMirror.addLineClass(location.line - 1, "background", "ti-highlight");
			setTimeout(function () {
				this.hostEditor._codeMirror.removeLineClass(location.line - 1, "background", "ti-highlight");
			}.bind(this), 2000);		
		}

	   event.stopPropagation(); 
   };

	/**
	 * Click handler for clicks on the widget. Will show a editor for the doc part that was targeted if any. 
	 * @param  {object} event 
	 */
	DocumentationInlineEditor.prototype._clickHandler = function(event) {
		var $target = $(event.currentTarget);

		if ($target.hasClass('ti-property')) {
			var argumentId = $target.data("argumentId"); 
			if (argumentId !== undefined) {
				this.docPartSpecifier = { partType: "parameters", id: argumentId }; 
			} else {
				this.docPartSpecifier = { partType: "return" }; 
			}            
		} else {
			this.docPartSpecifier = { partType: "description" }; 
		}

		this._displayEditorForPartOfTypeInfo();
		event.stopPropagation();
	};

	/**
	 * Close the inline editor and send the updated type information to the store. 
	 */
	DocumentationInlineEditor.prototype._closeEditor = function() {
		if (this.inlineEditor !== null) {
			//tear down notifications to make sure don't get a blur event that would cause us to forget the docPartSpecifier
			this.inlineEditor.off("blur", this._onEditorBlur);
			this.inlineEditor.off("update", this._onEditorUpdate);

			var jsdocString = this.inlineEditor.getValue();

			this.typeInformation.updateWithJSDoc(jsdocString, this.inlineEditor.displayedDocPartSpecifier);

			this.inlineEditor = null;
		}
	};

	/**
	 * This function shows an editor for the specified part of the document part. Other open editors are closed. 
	 * @param  {{partType: string, id: number}} docPartSpecifier partType can be "parameters", "description"
	 */
	DocumentationInlineEditor.prototype._displayEditorForPartOfTypeInfo = function() {
		if (this.docPartSpecifier === undefined) {
			return;
		}

		var codeMirrorOptions = {
			mode: "markdown",
			theme: "default",
			lineNumbers: false,
			height: "dynamic", 
			minHeight: 20
		};

		var $target;
		var jsDoc;
		var needsTopMargin = false; 

		switch (this.docPartSpecifier.partType) {
			case "description": 
				jsDoc = (this.typeInformation.description === undefined) ? "" : this.typeInformation.description; 
				$target = this.$contentDiv.find(".ti-description");
				needsTopMargin = $target.is(":empty");
				break; 
			case "parameters": 
				jsDoc = this.typeInformation.argumentTypes[this.docPartSpecifier.id].toJSDoc();

				var self = this; 
				$target = this.$contentDiv.find(".ti-property").filter(function (index) {
					//this inside this filter function refers to the DOM element!
					return $(this).data("argumentId") === self.docPartSpecifier.id;
				}); 
				break;
			case "return": 
				jsDoc = this.typeInformation.returnType.toJSDoc(true);

				$target = this.$contentDiv.find(".ti-property").filter(function (index) {
					return $(this).data("argumentId") === undefined;
				});
				break;
			default: 
				TIUtils.log("Unknown docPartSpecifier: " + this.docPartSpecifier.partType); 
				return;
		}

		codeMirrorOptions.value = jsDoc;

		this.inlineEditor = new CodeMirror(function (element) {
			if (needsTopMargin) {
				$(element).css("margin-top", "3px");
			}
			$target.html(element);
		}, codeMirrorOptions);

		this.inlineEditor.on("keydown", this._onEditorKeyEvent);
		this.inlineEditor.on("blur", this._onEditorBlur);
		this.inlineEditor.on("update", this._onEditorUpdate);

		this.inlineEditor.displayedDocPartSpecifier = this.docPartSpecifier; 

		this.inlineEditor.focus();
		this.inlineEditor.setCursor(0, jsDoc.length - 1);

		// this.hostEditor.setInlineWidgetHeight(this, this.$contentDiv.height(), true);
	};

	/**
	 * Key handler for the inline editors. Captures the Arrow Up/Down events to move between editors.
	 * @param  {CodeMirror} theEditor
	 * @param  {Event} event
	 */
	DocumentationInlineEditor.prototype._onEditorKeyEvent = function (theEditor, event) {
		//sanity checks
		if ((event.type !== "keydown") || (theEditor !== this.inlineEditor)) {
			TIUtils.log("_onEditorKeyEvent callback called with invalid event or unknown editor");
			return;
		}

		var cursorPos = this.inlineEditor.getCursor();
		var range, line;

		switch (event.keyCode) {
			case 38: //Arrow Up Key
				//Arrow Key Up
				if (cursorPos.line === 0) {
					this.docPartSpecifier = this._nextDocPartSpecifierForDocPartSpecifier(this.docPartSpecifier, true);
					if (this.docPartSpecifier === undefined) {
						//refocus host editor
						range = this.getCurrentRange(); 
						line = this.hostEditor.document.getLine(range.start.line - 1); 
						this.hostEditor.setCursorPos({ line: range.start.line - 1, ch: line.length }); 
						this.hostEditor.focus();
					}
					this._render();
				}
				break;
			case 40:
				if (cursorPos.line === this.inlineEditor.lineCount() - 1) {
					this.docPartSpecifier = this._nextDocPartSpecifierForDocPartSpecifier(this.docPartSpecifier);
					if (this.docPartSpecifier === undefined) {
						range = this.getCurrentRange(); 
						line = this.hostEditor.document.getLine(range.end.line + 1); 
						this.hostEditor.setCursorPos({ line: range.end.line + 1, ch: line.length }); 
						this.hostEditor.focus(); 
					}
					this._render();
				}
				break;
		}
	};

	/**
	 * Handler for when an editor looses focus
	 */
	DocumentationInlineEditor.prototype._onEditorBlur = function() {
		this.docPartSpecifier = undefined;
		this._render();
	};

	/**
	 * Handler for editor dom updates
	 */
	
	DocumentationInlineEditor.prototype._onEditorUpdate = function() {
		this._recalculateHeight();
	};

	/**
	 * This function returns the docPartSpecifier before or after the given one. If there is no next or previous docPartSpecifier, it
	 * will return undefined.
	 * @param  {DocPartSpecifier}   docPartSpecifier
	 * @param  {boolean}            backwards           If set to true, return the predecessor instead of the successor. Default is false
	 * @return {DocPartSpecifier}
	 */
	DocumentationInlineEditor.prototype._nextDocPartSpecifierForDocPartSpecifier = function(docPartSpecifier, backwards) {
		if (backwards === undefined) {
			backwards = false;
		}
		var result = _.clone(docPartSpecifier);

		var increment = backwards ? -1 : 1; 
		var localDocPartOrder = this._availableDocPartTypes();

		var partTypeIndex = localDocPartOrder.indexOf(result.partType); 

		if (((result.id > 0) && backwards) || ((result.id < this._maxIdForDocPartType(result.partType)) && !backwards)) {
			result.id += increment; 
		} else if (((partTypeIndex > 0) && backwards) || ((partTypeIndex < localDocPartOrder.length - 1) && !backwards)) {
			result.partType = localDocPartOrder[partTypeIndex + increment];
			result.id = backwards ? this._maxIdForDocPartType(result.partType) : 0;
		} else {
			return undefined;
		}

		return result;
	};

	/**
	 * Returns the docPartTypes that are available for the current typeInformation
	 * @return {[string]}
	 */
	DocumentationInlineEditor.prototype._availableDocPartTypes = function() {
		var localDocPartOrder = _.clone(DOC_PART_ORDER);
		if ((this.typeInformation.argumentTypes === undefined) || (this.typeInformation.argumentTypes.length === 0)) {
			localDocPartOrder.splice(localDocPartOrder.indexOf("parameters"), 1);
		}
		if (this.typeInformation.returnType === undefined) {
			localDocPartOrder.splice(localDocPartOrder.indexOf("return"), 1);
		}

		return localDocPartOrder;
	};

	/**
	 * Returns the maximum value for the id part of a DocPartSpecifier, given a particular partType
	 * @param  {String} partType
	 * @return {Number}
	 */
	DocumentationInlineEditor.prototype._maxIdForDocPartType = function(partType) {
		var result;

		switch (partType) {
			case "parameters": 
				result = this.typeInformation.argumentTypes.length - 1; 
				break;
			default: 
				result = 0;
		}

		return result;
	};

	module.exports = DocumentationInlineEditor;
});