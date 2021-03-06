/*
    This file is part of web3.js.

    web3.js is free software: you can redistribute it and/or modify
    it under the terms of the GNU Lesser General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    web3.js is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Lesser General Public License for more details.

    You should have received a copy of the GNU Lesser General Public License
    along with web3.js.  If not, see <http://www.gnu.org/licenses/>.
*/
/**
 * @file function.js
 * @author Marek Kotewicz <marek@ethdev.com>
 * @date 2015
 */

var coder = require('../solidity/coder');
var utils = require('../utils/utils');
var errors = require('./errors');
var formatters = require('./formatters');
var sha3 = require('../utils/sha3');

/**
 * This prototype should be used to call/sendTransaction to solidity functions
 */
var SolidityFunction = function (dece, json, address, abiv2) {
    this._dece = dece;
    this._inputTypes = json.inputs.map(function (i) {
        return i.type;
    });
    this._outputTypes = json.outputs.map(function (i) {
        return i.type;
    });
    if (json.stateMutability !== "nonpayable" && json.stateMutability !== "payable" ){
        this._constant = true;
    }else {
        this._constant = false;
    }

    if (json.stateMutability === "payable" ){
        this._payable = true;
    }else {
        this._payable= false;
    }

    if (json.hasOwnProperty("constant") ){
        this._constant = json.constant;
    }

    if (json.hasOwnProperty("payable") ){
        this._payable = json.payable;
    }

    this._name = utils.transformToFullName(json);
    this._address = address;
    this._abiv2 = abiv2;
    this.abi = json;
};

SolidityFunction.prototype.extractCallback = function (args) {
    if (utils.isFunction(args[args.length - 1])) {
        return args.pop(); // modify the args array!
    }
};

SolidityFunction.prototype.extractDefaultBlock = function (args) {
    if (args.length > this._inputTypes.length && !utils.isObject(args[args.length -1])) {
        return formatters.inputDefaultBlockNumberFormatter(args.pop()); // modify the args array!
    }
};

/**
 * Should be called to check if the number of arguments is correct
 *
 * @method validateArgs
 * @param {Array} arguments
 * @throws {Error} if it is not
 */
SolidityFunction.prototype.validateArgs = function (args) {
    var inputArgs = args.filter(function (a) {
      // filter the options object but not arguments that are arrays
      return !( (utils.isObject(a) === true) &&
                (utils.isArray(a) === false) &&
                (utils.isBigNumber(a) === false)
              );
    });
    if (inputArgs.length !== this._inputTypes.length) {
        throw errors.InvalidNumberOfSolidityArgs();
    }
};

/**
 * Should be used to create payload from arguments
 *
 * @method toPayload
 * @param {Array} solidity function params
 * @param {Object} optional payload options
 */
SolidityFunction.prototype.toPayload = function (args) {
    var options = {};
    if (args.length > this._inputTypes.length && utils.isObject(args[args.length -1])) {
        options = args[args.length - 1];
    }
    this.validateArgs(args);
    options.to = this._address;
    var dy = false;
    if (options.hasOwnProperty("dy")){
        dy = options.dy;
    }
    var rand = utils.bytesToHex(utils.base58ToBytes(this._address).slice(0,16));
    var convertResult = coder.opParams(this._inputTypes,args,rand,this._dece,dy);
    args = convertResult.params;
    options.data = coder.addressPrefix(this._inputTypes,args,rand) + this.signature()+ coder.encodeParams(this._inputTypes, args,convertResult.shortAddr);
    return options;
};

SolidityFunction.prototype.toPayloadCall = function (args,callback) {
    var options = {};
    if (args.length > this._inputTypes.length && utils.isObject(args[args.length -1])) {
        options = args[args.length - 1];
    }
    this.validateArgs(args);
    options.to = this._address;
    var dy = false;
    if (options.hasOwnProperty("dy")){
        dy = options.dy;
    }
    var rand = utils.bytesToHex(utils.base58ToBytes(this._address).slice(0,16));
    var self = this;
    var cb = function(err,result){
        if (err){
            throw errors.InvalidResponse(err);
        }
        args = result.params;
        options.data = coder.addressPrefix(self._inputTypes,args,rand) + self.signature()+ coder.encodeParams(self._inputTypes, args,result.shortAddr);
        callback(options)
    }
    coder.opParams(this._inputTypes,args,rand,this._dece,dy,cb);
};

/**
 * Should be used to get function signature
 *
 * @method signature
 * @return {String} function signature
 */
SolidityFunction.prototype.signature = function () {
    return sha3(this._name).slice(0, 8);
};


SolidityFunction.prototype.unpackOutput = function (output,callback) {
    if (!output) {
        return;
    }

    output = output.length >= 2 ? output.slice(2) : output;
    var self = this;
    var shortAddress=[];
    try{

        shortAddress = coder.decodeShortAddress(this._outputTypes,output);

    }catch(e){
        if (output.length>=8 &&output.slice(0,8)== "08c379a0") {
            var result = coder.decodeParams(["string"],output.slice(8),null);

            throw new Error("output invalid, reason = " + result + "\noutput = "+ output);
        }else {
            throw new Error("unpackOutput error = " + e.toString()+ "\noutput = "+ output);
        }



    }



    if (!callback) {
        var tys = coder.getSolidityTypes(this._outputTypes);
        if (tys && tys.length>0){
            try {
                var addrMap = this._dece.getFullAddress(shortAddress);
                var result = coder.decodeParams(this._outputTypes, output,addrMap);
                return result.length === 1 ? result[0] : result;
            }catch (e) {
                if(output.length>=8 && output.slice(0,8)== "08c379a0"){
                    var result = coder.decodeParams(["string"],output.slice(8),null);

                    throw new Error("required,reason = " + result + "\noutput = "+ output);
                }else {
                    throw new Error("unpackOutput error = " + e.toString()+ "\noutput = "+ output);
                }
            }

        }else {
            if (output.length>=8 &&output.slice(0,8)== "08c379a0") {
                var result = coder.decodeParams(["string"],output.slice(8),null);

                throw new Error("required,reason = " + result + "\noutput = "+ output);
            }
        }
    }

    if (shortAddress.length>0) {
        var cb =  function(err,mapAddr){
            if (err) {
                throw err;
            }
            var result = coder.decodeParams(self._outputTypes, output,mapAddr);
            result = result.length === 1 ? result[0] : result;
            callback(err,result);
        }
        this._dece.getFullAddress(shortAddress,cb);

    }else{
        var result = coder.decodeParams(this._outputTypes, output,null);
        result =  result.length === 1 ? result[0] : result;
        callback(null,result);
    }

};

/**
 * Calls a contract function.
 *
 * @method call
 * @param {...Object} Contract function arguments
 * @param {function} If the last argument is a function, the contract function
 *   call will be asynchronous, and the callback will be passed the
 *   error and result.
 * @return {String} output bytes
 */
SolidityFunction.prototype.call = function () {
    var args = Array.prototype.slice.call(arguments).filter(function (a) {return a !== undefined; });
    var callback = this.extractCallback(args);
    var defaultBlock = this.extractDefaultBlock(args);

    if (!callback) {
        var payload = this.toPayload(args);
        var output = this._dece.call(payload, defaultBlock);
        return this.unpackOutput(output);
    }

    var self = this;
    var cb =  function(payload){
        self._dece.call(payload, defaultBlock, function (error, output) {
            if (error) return callback(error, null);

            var unpacked = null;
            try {
                self.unpackOutput(output,callback);
            }
            catch (e) {
                error = e;
            }
        });
    }
    this.toPayloadCall(args,cb);

};

/**
 * Should be used to sendTransaction to solidity function
 *
 * @method sendTransaction
 */
SolidityFunction.prototype.sendTransaction = function () {
    var args = Array.prototype.slice.call(arguments).filter(function (a) {return a !== undefined; });
    var callback = this.extractCallback(args);
    var options = {};
    if (args.length > this._inputTypes.length && utils.isObject(args[args.length -1])) {
        options = args[args.length - 1];
    }
    if (options.value > 0 && !this._payable) {
        throw new Error('Cannot send value to non-payable function');
    }
    if (!callback) {
        var payload = this.toPayload(args);
        return this._dece.sendTransaction(payload);
    }
    var self = this;
    var cb =function(payload){
        self._dece.sendTransaction(payload, callback);
    }
    this.toPayloadCall(args,cb);


};

/**
 * Should be used to estimateGas of solidity function
 *
 * @method estimateGas
 */
SolidityFunction.prototype.estimateGas = function () {
    var args = Array.prototype.slice.call(arguments);
    var callback = this.extractCallback(args);
    if (!callback) {
        var payload = this.toPayload(args);
        return this._dece.estimateGas(payload);
    }

    var self = this;
    var cb =function(payload){
        self._dece.estimateGas(payload, callback);
    }
    this.toPayloadCall(args,cb);
};

/**
 * Return the encoded data of the call
 *
 * @method getData
 * @return {String} the encoded data
 */
SolidityFunction.prototype.getData = function () {
    var args = Array.prototype.slice.call(arguments);
    var callback = this.extractCallback(args);
    if (!callback){
        var payload = this.toPayload(args);
        return payload.data;
    }
    var cb = function(result){
        callback(result.data);
    }
    this.toPayloadCall(args,cb);

};

/**
 * Should be used to get function display name
 *
 * @method displayName
 * @return {String} display name of the function
 */
SolidityFunction.prototype.displayName = function () {
    return utils.extractDisplayName(this._name);
};

/**
 * Should be used to get function type name
 *
 * @method typeName
 * @return {String} type name of the function
 */
SolidityFunction.prototype.typeName = function () {
    return utils.extractTypeName(this._name);
};

/**
 * Should be called to get rpc requests from solidity function
 *
 * @method request
 * @returns {Object}
 */
SolidityFunction.prototype.request = function () {
    var args = Array.prototype.slice.call(arguments);
    var callback = this.extractCallback(args);
    var payload = this.toPayload(args);
    var format = this.unpackOutput.bind(this);

    return {
        method: this._constant ? 'dece_call' : 'dece_sendTransaction',
        callback: callback,
        params: [payload],
        format: format
    };
};

/**
 * Should be called to execute function
 *
 * @method execute
 */
SolidityFunction.prototype.execute = function () {
    var transaction = !this._constant;

    // send transaction
    if (transaction) {
        return this.sendTransaction.apply(this, Array.prototype.slice.call(arguments));
    }

    // call
    return this.call.apply(this, Array.prototype.slice.call(arguments));
};

/**
 * Should be called to attach function to contract
 *
 * @method attachToContract
 * @param {Contract}
 */
SolidityFunction.prototype.attachToContract = function (contract) {
    var execute = this.execute.bind(this);
    execute.request = this.request.bind(this);
    execute.call = this.call.bind(this);
    execute.sendTransaction = this.sendTransaction.bind(this);
    execute.estimateGas = this.estimateGas.bind(this);
    execute.getData = this.getData.bind(this);
    var displayName = this.displayName();
    if (!contract[displayName]) {
        contract[displayName] = execute;
    }
    contract[displayName][this.typeName()] = execute; // circular!!!!
};

module.exports = SolidityFunction;
