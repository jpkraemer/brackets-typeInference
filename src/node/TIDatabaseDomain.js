/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global module, exports, require */

(function () { 
	"use strict";

	var NeDB = require('nedb');

	var db = {};

	/**
	 * Connects to a database
	 * @param  {String} Path to the datastore
	 * @return {String} A persistent handle to this database that needs to be passed for all commands
	 */
	function cmdConnect(path) {
		if (db[path] === undefined) {
			db[path] = new NeDB({ filename: path, autoload: true }); 
		}
		return path;
	}

	function _wrapNeDBFunctionToCommand (neDBFunction) {
		return function (handle) {
			var errback = arguments[arguments.length - 1];

			if (! db[handle]) {
				errback("Unknown DB handle");
			} else {
				var argumentsForNeDB = Array.prototype.slice.call(arguments, 1); 

				if (neDBFunction === NeDB.prototype.update) {
					//neDBs update methods uses a non-standard errback callback, we need to provide our own
					var callbackForNeDB = function (err, numReplaced, newDoc) {
						errback(err, { numReplaced: numReplaced, newDoc: newDoc });
					};
					
					argumentsForNeDB.splice(-1, 1, callbackForNeDB);
				}

				neDBFunction.apply(db[handle], argumentsForNeDB);

			}
		};
	}

	function init(domainManager) {
		if (!domainManager.hasDomain("TIDatabase")) {
			domainManager.registerDomain("TIDatabase", {major: 0, minor: 1}); 
		}

		domainManager.registerCommand(
			"TIDatabase",
			"connect",
			cmdConnect,
			false, 
			"Connects to a database",
			[{
				name: "path", 
				type: "string",
				description: "Path to the database file. Will be created if it does not exist."
			}], 
			[{
				name: "handle",
			  	type: "string",
			  	description: "A persistent handle to identify the database"
			}]
		);

		domainManager.registerCommand(
			"TIDatabase",
			"insert",
			_wrapNeDBFunctionToCommand(NeDB.prototype.insert),
			true, 
			"Inserts one or more documents to the database",
			[{
				name: "handle", 
				type: "string",
				description: "A persistent handle to identify the database"
			},
			{
				name: "doc", 
				type: "object",
				description: "The document to insert or an array of docs"
			}], 
			[{
				name: "newDoc",
			  	type: "object",
			  	description: "The updated document(s) after insertion. Includes _id"
			}]
		);

		domainManager.registerCommand(
			"TIDatabase",
			"find",
			_wrapNeDBFunctionToCommand(NeDB.prototype.find),
			true, 
			"Finds documents in the database",
			[{
				name: "handle", 
				type: "string",
				description: "A persistent handle to identify the database"
			},
			{
				name: "query", 
				type: "object",
				description: "The NeDB query"
			}], 
			[{
				name: "docs",
			  	type: "object",
			  	description: "The document(s) returned from the query"
			}]
		);

		domainManager.registerCommand(
			"TIDatabase",
			"update",
			_wrapNeDBFunctionToCommand(NeDB.prototype.update),
			true, 
			"Finds documents in the database",
			[{
				name: "handle", 
				type: "string",
				description: "A persistent handle to identify the database"
			},
			{
				name: "query", 
				type: "object",
				description: "The NeDB query to identify documents to update"
			},
			{
				name: "update", 
				type: "object",
				description: "The update rules to apply to the identified records"
			},
			{
				name: "options", 
				type: "object",
				description: "Set multi to true to allow modification of multiple docs; set upsert to true to allow insertion when query returns nothing"
			}], 
			[{
				name: "docs",
			  	type: "object",
			  	description: "The document(s) returned from the query"
			}]
		);

		domainManager.registerCommand(
			"TIDatabase",
			"remove",
			_wrapNeDBFunctionToCommand(NeDB.prototype.remove),
			true, 
			"Removes documents from the database",
			[{
				name: "handle", 
				type: "string",
				description: "A persistent handle to identify the database"
			},
			{
				name: "query", 
				type: "object",
				description: "The NeDB query to identify documents to update"
			},
			{
				name: "options", 
				type: "object",
				description: "Set multi to true to allow deletion of multiple docs"
			}], 
			[{
				name: "numRemoved",
			  	type: "number",
			  	description: "The number of document(s) deleted"
			}]
		);

		domainManager.registerCommand(
			"TIDatabase",
			"ensureIndex",
			_wrapNeDBFunctionToCommand(NeDB.prototype.ensureIndex),
			true, 
			"Configures indexing on  the database",
			[{
				name: "handle", 
				type: "string",
				description: "A persistent handle to identify the database"
			},
			{
				name: "options", 
				type: "object",
				description: "The NeDB index specification"
			}], 
			[{
				name: "numRemoved",
			  	type: "number",
			  	description: "The number of document(s) deleted"
			}]
		);
	}

	exports.init = init;

}());