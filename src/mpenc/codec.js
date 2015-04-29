/*
 * Created: 19 Mar 2014 Guy K. Kloss <gk@mega.co.nz>
 *
 * (c) 2014-2015 by Mega Limited, Auckland, New Zealand
 *     http://mega.co.nz/
 *
 * This file is part of the multi-party chat encryption suite.
 *
 * This code is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3
 * as published by the Free Software Foundation. See the accompanying
 * LICENSE file or <https://www.gnu.org/licenses/> if it is unavailable.
 *
 * This code is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

define([
    "mpenc/helper/assert",
    "mpenc/helper/utils",
    "mpenc/version",
    "asmcrypto",
    "jodid25519",
    "megalogger",
], function(assert, utils, version, asmCrypto, jodid25519, MegaLogger) {
    "use strict";

    /**
     * @exports mpenc/codec
     * Implementation of a protocol encoder/decoder.
     *
     * @description
     * <p>Implementation of a protocol encoder/decoder.</p>
     *
     * <p>
     * The implementation is finally aiming to mock the binary encoding scheme
     * as used by OTR. But initially it will use a somewhat JSON-like
     * intermediate.</p>
     */
    var ns = {};

    var _assert = assert.assert;

    var _PROTOCOL_INDICATOR = 'mpENC';
    var _PROTOCOL_PREFIX = '?' + _PROTOCOL_INDICATOR;

    var logger = MegaLogger.getLogger('codec', undefined, 'mpenc');

    // TODO: high-priority - put range checks etc on decode functions

    /**
     * "Enumeration" of protocol message types.
     *
     * @property PLAIN {integer}
     *     Plain text message (not using mpENC).
     * @property MPENC_QUERY {integer}
     *     Query to initiate an mpENC session.
     * @property MPENC_GREET_MESSAGE {integer}
     *     mpENC greet message.
     * @property MPENC_DATA_MESSAGE {integer}
     *     mpENC data message.
     * @property MPENC_ERROR {integer}
     *     Message for error in mpENC protocol.
     */
    ns.MESSAGE_TYPE = {
        PLAIN:               0x00,
        MPENC_QUERY:         0x01,
        MPENC_GREET_MESSAGE: 0x02,
        MPENC_DATA_MESSAGE:  0x03,
        MPENC_ERROR:         0x04,
    };


    // Add reverse mapping to string representation.
    ns.MESSAGE_TYPE_MAPPING = {};
    for (var propName in ns.MESSAGE_TYPE) {
        ns.MESSAGE_TYPE_MAPPING[ns.MESSAGE_TYPE[propName]] = propName;
    }


    // "Magic numbers" used for prepending the data for the purpose of signing.
    var _MAGIC_NUMBERS = {};
    _MAGIC_NUMBERS[ns.MESSAGE_TYPE.MPENC_GREET_MESSAGE] = 'greetmsgsig';
    _MAGIC_NUMBERS[ns.MESSAGE_TYPE.MPENC_DATA_MESSAGE] = 'datamsgsig';
    _MAGIC_NUMBERS[ns.MESSAGE_TYPE.MPENC_ERROR] = 'errormsgsig';


    /**
     * "Enumeration" for TLV record types.
     *
     * @property PROTOCOL_VERSION {integer}
     *     Indicates the protocol version to be used as a 16-bit unsigned integer.
     * @property DATA_MESSAGE {string}
     *     Data payload (chat message) content of the message.
     * @property MESSAGE_SIGNATURE {string}
     *     Signature of the entire message sent (must be the first TLV sent,
     *     and sign *all* remaining binary content).
     * @property MESSAGE_IV {string}
     *     Random initialisation vector for encrypted message payload.
     * @property GREET_TYPE {integer}
     *     mpENC protocol message type. See `GREET_TYPE`.
     * @property SIDKEY_HINT {integer}
     *     Hints at the right combination of session ID and group key used for
     *     a data message.
     * @property SOURCE {integer}
     *     Message originator ("from", must be only one).
     * @property DEST {integer}
     *     Message destination ("to", should be only one, broadcast if not
     *     present or empty).
     * @property MEMBER {integer}
     *     A participating member's ID.
     * @property INT_KEY {integer}
     *     An intermediate key for the group key agreement (max. occurrence is
     *     the number of members present).
     * @property NONCE {integer}
     *     A nonce of a member for ASKE (max. occurrence is the number of
     *     members present).
     * @property PUB_KEY {integer}
     *     Ephemeral public signing key of a member (max. occurrence is the
     *     number of members present).
     * @property SESSION_SIGNATURE {integer}
     *     Session acknowledgement signature using sender's static key.
     * @property SIGNING_KEY {integer}
     *     Session's ephemeral (private) signing key, published upon departing
     *     from a chat.
     */
    ns.TLV_TYPE = {
        MESSAGE_SIGNATURE: 0x0003, // 3
        PROTOCOL_VERSION:  0x0001, // 1
        MESSAGE_TYPE:      0x0002, // 2
        // Data messages
        DATA_MESSAGE:      0x0010, // 16
        MESSAGE_IV:        0x0011, // 17
        SIDKEY_HINT:       0x0012, // 18
        // Greet messages
        GREET_TYPE:        0x01ff, // 511
        SOURCE:            0x0100, // 256
        DEST:              0x0101, // 257
        MEMBER:            0x0102, // 258
        INT_KEY:           0x0103, // 259
        NONCE:             0x0104, // 260
        PUB_KEY:           0x0105, // 261
        SESSION_SIGNATURE: 0x0106, // 262
        SIGNING_KEY:       0x0107, // 263
        // Error messages
        SEVERITY:          0x0201, // 513
    };


    /**
     * "Enumeration" defining the different mpENC error message severities.
     *
     * @property INFO {integer}
     *     An informational message with no or very low severity.
     * @property WARNING {integer}
     *     An warning message.
     * @property ERROR {integer}
     *     An error message with high severity.
     * @property TERMINAL {integer}
     *     A terminal error message that demands the immediate termination of
     *     all protocol execution. It should be followed by each participant's
     *     immediate invocation of a quit protocol flow.
     */
    ns.ERROR = {
        INFO:          0x00,
        WARNING:       0x01,
        TERMINAL:      0x02
    };

    // Add reverse mapping to string representation.
    ns._ERROR_MAPPING = {};
    for (var propName in ns.ERROR) {
        ns._ERROR_MAPPING[ns.ERROR[propName]] = propName;
    }


    // Message type bit mapping
    ns._AUX_BIT = 0;
    ns._DOWN_BIT = 1;
    ns._GKA_BIT = 2;
    ns._SKE_BIT = 3;
    ns._OP_BITS = 4;
    ns._INIT_BIT = 7;
    ns._RECOVER_BIT = 8;
    ns._OPERATION = { DATA: 0x00,
                      START: 0x01,
                      INCLUDE: 0x02,
                      EXCLUDE: 0x03,
                      REFRESH: 0x04,
                      QUIT: 0x05 };
    ns._OPERATION_MASK = 0x07 << ns._OP_BITS;
    // Add reverse mapping to string representation.
    ns.OPERATION_MAPPING = {};
    for (var propName in ns._OPERATION) {
        ns.OPERATION_MAPPING[ns._OPERATION[propName]] = propName;
    }


    /**
     * "Enumeration" message types.
     *
     * @property INIT_INITIATOR_UP {string}
     *     Initiator initial upflow.
     * @property INIT_PARTICIPANT_UP {string}
     *     Participant initial upflow message.
     * @property INIT_PARTICIPANT_DOWN {string}
     *     Participant initial downflow.
     * @property INIT_PARTICIPANT_CONFIRM_DOWN {string}
     *     Participant initial subsequent downflow.
     * @property RECOVER_INIT_INITIATOR_UP {string}
     *     Initiator initial upflow for recovery.
     * @property RECOVER_INIT_PARTICIPANT_UP {string}
     *     Participant initial upflow message for recovery.
     * @property RECOVER_INIT_PARTICIPANT_DOWN {string}
     *     Participant initial downflow for recovery.
     * @property RECOVER_INIT_PARTICIPANT_CONFIRM_DOWN {string}
     *     Participant initial subsequent downflow for recovery.
     * @property INCLUDE_AUX_INITIATOR_UP {string}
     *     Initiator aux include upflow.
     * @property INCLUDE_AUX_PARTICIPANT_UP {string}
     *     Participant aux include upflow.
     * @property INCLUDE_AUX_PARTICIPANT_DOWN {string}
     *     Participant aux include downflow.
     * @property INCLUDE_AUX_PARTICIPANT_CONFIRM_DOWN {string}
     *     Participant aux include subsequent downflow.
     * @property EXCLUDE_AUX_INITIATOR_DOWN {string}
     *     Initiator aux exclude downflow.
     * @property EXCLUDE_AUX_PARTICIPANT_CONFIRM_DOWN {string}
     *     Participant aux exclude subsequent.
     * @property RECOVER_EXCLUDE_AUX_INITIATOR_DOWN {string}
     *     Initiator aux exclude downflow for recovery.
     * @property RECOVER_EXCLUDE_AUX_PARTICIPANT_CONFIRM_DOWN {string}
     *     Participant aux exclude subsequent for recovery.
     * @property REFRESH_AUX_INITIATOR_DOWN {string}
     *     Initiator aux refresh downflow.
     * @property REFRESH_AUX_PARTICIPANT_DOWN {string}
     *     Participant aux refresh downflow.
     * @property RECOVER_REFRESH_AUX_INITIATOR_DOWN {string}
     *     Initiator aux refresh downflow. for recovery
     * @property RECOVER_REFRESH_AUX_PARTICIPANT_DOWN {string}
     *     Participant aux refresh downflow for recovery.
     * @property QUIT_DOWN {string}
     *     Indicating departure. (Must be followed by an exclude sequence.)
     */
    ns.GREET_TYPE = {
        // Initial start sequence.
        INIT_INITIATOR_UP:                     '\u0000\u009c', // 0b10011100
        INIT_PARTICIPANT_UP:                   '\u0000\u001c', // 0b00011100
        INIT_PARTICIPANT_DOWN:                 '\u0000\u001e', // 0b00011110
        INIT_PARTICIPANT_CONFIRM_DOWN:         '\u0000\u001a', // 0b00011010
        RECOVER_INIT_INITIATOR_UP:             '\u0001\u009c', // 0b10011100
        RECOVER_INIT_PARTICIPANT_UP:           '\u0001\u001c', // 0b00011100
        RECOVER_INIT_PARTICIPANT_DOWN:         '\u0001\u001e', // 0b00011110
        RECOVER_INIT_PARTICIPANT_CONFIRM_DOWN: '\u0001\u001a', // 0b00011010
        // Include sequence.
        INCLUDE_AUX_INITIATOR_UP:              '\u0000\u00ad', // 0b10101101
        INCLUDE_AUX_PARTICIPANT_UP:            '\u0000\u002d', // 0b00101101
        INCLUDE_AUX_PARTICIPANT_DOWN:          '\u0000\u002f', // 0b00101111
        INCLUDE_AUX_PARTICIPANT_CONFIRM_DOWN:  '\u0000\u002b', // 0b00101011
        // Exclude sequence.
        EXCLUDE_AUX_INITIATOR_DOWN:            '\u0000\u00bf', // 0b10111111
        EXCLUDE_AUX_PARTICIPANT_CONFIRM_DOWN:  '\u0000\u003b', // 0b00111011
        RECOVER_EXCLUDE_AUX_INITIATOR_DOWN:    '\u0001\u00bf', // 0b10111111
        RECOVER_EXCLUDE_AUX_PARTICIPANT_CONFIRM_DOWN: '\u0001\u003b', // 0b00111011
        // Refresh sequence.
        REFRESH_AUX_INITIATOR_DOWN:            '\u0000\u00c7', // 0b11000111
        REFRESH_AUX_PARTICIPANT_DOWN:          '\u0000\u0047', // 0b01000111
        RECOVER_REFRESH_AUX_INITIATOR_DOWN:    '\u0001\u00c7', // 0b11000111
        RECOVER_REFRESH_AUX_PARTICIPANT_DOWN:  '\u0001\u0047', // 0b01000111
        // Quit indication.
        QUIT_DOWN:                             '\u0000\u00d3'  // 0b11010011
    };


    /** Mapping of message type to string representation. */
    ns.GREET_TYPE_MAPPING = {};
    for (var propName in ns.GREET_TYPE) {
        ns.GREET_TYPE_MAPPING[ns.GREET_TYPE[propName]] = propName;
    }


    /**
     * Converts a message type string to a number.
     *
     * @param typeString {string}
     * @return {integer}
     *     Number representing the message type.
     */
    ns.greetTypeToNumber = function(typeString) {
        return (typeString.charCodeAt(0) << 8)
                | typeString.charCodeAt(1);
    };


    /**
     * Converts a message type number to a message type string.
     *
     * @param typeNumber {integer}
     * @return {string}
     *     Two character string of message type.
     */
    ns.greetTypeFromNumber = function(typeNumber) {
        return String.fromCharCode(typeNumber >>> 8)
               + String.fromCharCode(typeNumber & 0xff);
    };


    // Checks whether a specific bit is set on a message type.
    function _isBitSetOnGreetType(greetType, bit) {
        if (typeof(greetType) === 'string') {
            greetType = ns.greetTypeToNumber(greetType);
        }
        return ((greetType & (1 << bit)) > 0);
    }


    /**
     * Inspects the AUX bit of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {boolean}
     *     True if the bit is set, otherwise false.
     */
    ns.isAuxBitOnGreenType = function(greetType) {
        return _isBitSetOnGreetType(greetType, ns._AUX_BIT);
    };


    /**
     * Inspects the DOWN bit of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {boolean}
     *     True if the bit is set, otherwise false.
     */
    ns.isDownBitOnGreetType = function(greetType) {
        return _isBitSetOnGreetType(greetType, ns._DOWN_BIT);
    };


    /**
     * Inspects the GKA bit of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {boolean}
     *     True if the bit is set, otherwise false.
     */
    ns.isGkaBitOnGreetType = function(greetType) {
        return _isBitSetOnGreetType(greetType, ns._GKA_BIT);
    };


    /**
     * Inspects the SKE bit of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {boolean}
     *     True if the bit is set, otherwise false.
     */
    ns.isSkeBitOnGreetType = function(greetType) {
        return _isBitSetOnGreetType(greetType, ns._SKE_BIT);
    };


    /**
     * Inspects the INIT bit of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {boolean}
     *     True if the bit is set, otherwise false.
     */
    ns.isInitBitOnGreetType = function(greetType) {
        return _isBitSetOnGreetType(greetType, ns._INIT_BIT);
    };


    /**
     * Inspects the RECOVER bit of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {boolean}
     *     True if the bit is set, otherwise false.
     */
    ns.isRecoverBitOnGreetType = function(greetType) {
        return _isBitSetOnGreetType(greetType, ns._RECOVER_BIT);
    };


    /**
     * Inspects the OPERATION bits of the message type.
     *
     * @param {integer|string}
     *     Message type, either as a number or two character string.
     * @return {integer}
     *     Number of the operation.
     */
    ns.getOperationOnGreetType = function(greetType) {
        if (typeof(greetType) === 'string') {
            greetType = ns.greetTypeToNumber(greetType);
        }
        return (greetType & ns._OPERATION_MASK) >>> ns._OP_BITS;
    };


    /**
     * Carries message content for the mpENC protocol flow and data messages.
     *
     * @constructor
     * @param source {string}
     *     Message originator (from).
     * @returns {mpenc.codec.ProtocolMessage}
     *
     * @property source {string|object}
     *     Message originator (from) or a {ProtocolMessage} object to copy.
     * @property dest {string}
     *     Message destination (to).
     * @property greetType {string}
     *     mpENC protocol message type, one of {mpenc.codec.GREET_TYPE}.
     * @property sidkeyHint {string}
     *     One character string (a single byte), hinting at the right
     *     combination of session ID and group key used for a data message.
     * @property members {Array<string>}
     *     List (array) of all participating members.
     * @property intKeys {Array<string>}
     *     List (array) of intermediate keys for group key agreement.
     * @property debugKeys {Array<string>}
     *     List (array) of keying debugging strings.
     * @property nonces {Array<string>}
     *     Nonces of members for ASKE.
     * @property pubKeys {Array<string>}
     *     Ephemeral public signing key of members.
     * @property sessionSignature {string}
     *     Session acknowledgement signature using sender's static key.
     * @property signingKey {string}
     *     Ephemeral private signing key for session (upon quitting participation).
     * @property signature {string}
     *     Binary signature string for the message
     * @property signatureOk {bool}
     *     Indicator whether the message validates. after message decoding.
     * @property rawMessage {string}
     *     The raw message, after splitting off the signature. Can be used to
     *     re-verify the signature, if needed.
     * @property protocol {string}
     *     Single byte string indicating the protocol version using the binary
     *     version of the character.
     * @property data {string}
     *     Binary string containing the decrypted pay load of the message.
     */
    var ProtocolMessage = function(source) {
        if (source === undefined) {
            source = {};
        }
        if (source instanceof Object) {
            this.source = source.source || '';
        } else {
            this.source = source || '';
        }
        this.dest = source.dest || '';
        this.greetType = source.greetType || null;
        this.sidkeyHint = source.sidkeyHint || null;
        this.members = source.members || [];
        this.intKeys = source.intKeys || [];
        this.debugKeys = source.debugKeys || [];
        this.nonces = source.nonces || [];
        this.pubKeys = source.pubKeys || [];
        this.sessionSignature = source.sessionSignature || null;
        this.signingKey = source.signingKey || null;
        this.signature = source.signature || null;
        this.signatureOk = source.signatureOk || false;
        this.rawMessage = source.rawMessage || null;
        this.protocol = source.protocol || null;
        this.data = source.data || null;

        return this;
    };
    ns.ProtocolMessage = ProtocolMessage;


    /**
     * Returns a numeric representation of the message type.
     *
     * @method
     * @returns {integer}
     *     Message type as numeric value.
     */
    ProtocolMessage.prototype.getGreetTypeNumber = function() {
        return ns.greetTypeToNumber(this.greetType);
    };


    /**
     * Returns a string representation of the message type.
     *
     * @method
     * @returns {string}
     *     Message type as human readable string.
     */
    ProtocolMessage.prototype.getGreetTypeString = function() {
        return ns.GREET_TYPE_MAPPING[this.greetType];
    };


    /**
     * Sets a bit on the message type to a particular value.
     *
     * @method
     * @param {integer}
     *     Bit number to modify.
     * @param {bool}
     *     Value to set bit to.
     * @param {bool}
     *     If `true`, no checks for legal message transitions are performed
     *     (default: false).
     * @throws {Error}
     *     In case of a resulting illegal/non-existent message type.
     */
    ProtocolMessage.prototype._setBit= function(bit, value, noMessageCheck) {
        var newGreetTypeNum = this.getGreetTypeNumber();
        if (value === true || value === 1) {
            newGreetTypeNum |= 1 << bit;
        } else if (value === 0 || value === false) {
            newGreetTypeNum &= 0xffff - (1 << bit);
        } else {
            throw new Error("Illegal value for set/clear bit operation.");
        }
        var newGreetType = ns.greetTypeFromNumber(newGreetTypeNum);
        if (ns.GREET_TYPE_MAPPING[newGreetType] === undefined) {
            if (noMessageCheck !== true && noMessageCheck !== 1) {
                throw new Error("Illegal message type!");
            } else {
                this.greetType = newGreetType;
                logger.debug('Arrived at an illegal message type, but was told to ignore it: '
                             + newGreetType);
            }
        } else {
            this.greetType = newGreetType;
        }
    };


    /**
     * Reads a bit on the message type to a particular value.
     *
     * @method
     * @param {integer}
     *     Bit number to read.
     * @return {bool}
     *     Value of bit.
     */
    ProtocolMessage.prototype._readBit= function(bit) {
        return (_isBitSetOnGreetType(this.greetType, bit));
    };


    /**
     * Returns whether the message is for an auxiliary protocol flow.
     *
     * @method
     * @returns {bool}
     *     `true` for an auxiliary protocol flow.
     */
    ProtocolMessage.prototype.isAuxiliary = function() {
        return this._readBit(ns._AUX_BIT);
    };


    /**
     * Returns whether the message is for the downflow (broadcast).
     *
     * @method
     * @returns {bool}
     *     `true` for a downflow message.
     */
    ProtocolMessage.prototype.isDownflow = function() {
        return this._readBit(ns._DOWN_BIT);
    };


    /**
     * Sets the downflow bit on the message type.
     *
     * @method
     * @param {bool}
     *     If `true`, no checks for legal message transitions are performed
     *     (default: false).
     * @throws {Error}
     *     In case of a resulting illegal/non-existent message type.
     */
    ProtocolMessage.prototype.setDownflow = function(noMessageCheck) {
        return this._setBit(ns._DOWN_BIT, true, noMessageCheck);
    };


    /**
     * Returns whether the message is for the Group Key Agreement.
     *
     * @method
     * @returns {bool}
     *     `true` for a message containing GKA content.
     */
    ProtocolMessage.prototype.isGKA = function() {
        return this._readBit(ns._GKA_BIT);
    };


    /**
     * Clears the Group Key Agreement bit on the message type.
     *
     * @method
     * @param {bool}
     *     If `true`, no checks for legal message transitions are performed
     *     (default: false).
     * @throws {Error}
     *     In case of a resulting illegal/non-existent message type.
     */
    ProtocolMessage.prototype.clearGKA = function(noMessageCheck) {
        return this._setBit(ns._GKA_BIT, false, noMessageCheck);
    };


    /**
     * Returns whether the message is for the Signature Key Exchange.
     *
     * @method
     * @returns {bool}
     *     `true` for a message containing SKE content.
     */
    ProtocolMessage.prototype.isSKE = function() {
        return this._readBit(ns._SKE_BIT);
    };


    /**
     * Returns whether the message is from the protocol flow initiator.
     *
     * @method
     * @returns {bool}
     *     `true` for a message from the protocol flow initiator.
     */
    ProtocolMessage.prototype.isInitiator = function() {
        return this._readBit(ns._INIT_BIT);
    };


    /**
     * Clears the initiator bit on the message type.
     *
     * @method
     * @param {bool}
     *     If `true`, no checks for legal message transitions are performed
     *     (default: false).
     * @throws {Error}
     *     In case of a resulting illegal/non-existent message type.
     */
    ProtocolMessage.prototype.clearInitiator = function(noMessageCheck) {
        return this._setBit(ns._INIT_BIT, false, noMessageCheck);
    };


    /**
     * Returns whether the message is for a recovery protocol flow.
     *
     * @method
     * @returns {bool}
     *     `true` for a message for a recovery flow.
     */
    ProtocolMessage.prototype.isRecover = function() {
        return this._readBit(ns._RECOVER_BIT);
    }


    /**
     * Returns the protocol operation of the message.
     *
     * @method
     * @returns {string}
     *     A clear text expression of the type of protocol operation.
     *     One of "DATA", "START", "INCLUDE", "EXCLUDE", "REFRESH" or "QUIT".
     */
    ProtocolMessage.prototype.getOperation = function() {
        return ns.OPERATION_MAPPING[(this.getGreetTypeNumber() & ns._OPERATION_MASK)
                                    >>> ns._OP_BITS];
    }


    /**
     * Decodes a given binary TLV string to a type and value.
     *
     * @param tlv {string}
     *     A binary TLV string.
     * @returns {Object}
     *     An object containing the type of string (in `type`, 16-bit unsigned
     *     integer) and the value (in `value`, binary string of the pay load).
     *     left over bytes from the input are returned in `rest`.
     */
    ns.decodeTLV = function(tlv) {
        var type = ns._bin2short(tlv.substring(0, 2));
        var length = ns._bin2short(tlv.substring(2, 4));
        var value = tlv.substring(4, 4 + length);
        _assert(length === value.length,
                'TLV payload length does not match indicated length.');
        if (length === 0) {
            value = '';
        }
        return {
            type: type,
            value: value,
            rest: tlv.substring(length + 4)
        };
    };


    /**
     * Decodes a given TLV value of a particular type, and do something with it.
     *
     * @param message {string}
     *     A binary TLV string.
     * @param type {string}
     *     Expected type of the TLV; throws an error if this doesn't match.
     * @param action {function}
     *     1-arg function to execute on the decoded value.
     * @returns {string}
     *     The rest of the string to decode later.
     */
    ns.popTLV = function(message, type, action) {
        var tlv = ns.decodeTLV(message);
        if (tlv.type !== type) {
            throw new Error("decode failed; expected TLV " + type + " but got " + tlv.type);
        }
        action(tlv.value);
        return tlv.rest;
    };


    /**
     * Decodes PROTOCOL_VERSION and MESSAGE_TYPE, present on all messages.
     *
     * @param message {string}
     *     A binary TLV string.
     * @param expectedType {string}
     *     Expected MESSAGE_TYPE, otherwise an error will be thrown.
     * @returns {string}
     *     The rest of the string to decode later.
     */
    ns.popStandardFields = function(message, expectedType, debugOutput) {
        debugOutput = debugOutput || [];
        var rest = message;
        rest = ns.popTLV(rest, ns.TLV_TYPE.PROTOCOL_VERSION, function(value) {
            if (value !== version.PROTOCOL_VERSION) {
                throw new Error("decode failed; expected PROTOCOL_VERSION "
                                + version.PROTOCOL_VERSION + " but got " + value);
            }
            debugOutput.push('protocol: ' + value.charCodeAt(0));
        });
        rest = ns.popTLV(rest, ns.TLV_TYPE.MESSAGE_TYPE, function(value) {
            value = value.charCodeAt(0);
            if (value !== expectedType) {
                throw new Error("decode failed; expected message type: "
                                + expectedType + " but got: " + value);
            }
            debugOutput.push('messageType: 0x'
                             + value.toString(16)
                             + ' (' + ns.MESSAGE_TYPE_MAPPING[value] + ')');
        });
        return rest;
    };


    /**
     * Decodes a given TLV value. If it matchs the expected type, run the action.
     * Otherwise do nothing and return the original string.
     */
    ns.popTLVMaybe = function(message, type, action) {
        var tlv = ns.decodeTLV(message);
        if (tlv.type !== type) {
            return message;
        }
        action(tlv.value);
        return tlv.rest;
    };


    /**
     * Keep decoding TLV values of a particular type, executing the action on
     * each decoded value. Stop when the next value is not of the expected type.
     */
    ns.popTLVAll = function(message, type, action) {
        var oldrest;
        var rest = message;
        do {
            oldrest = rest;
            rest = ns.popTLVMaybe(rest, type, action);
        } while (rest !== oldrest);
        return rest;
    };


    var _getMessageType = function(message) {
        if (!message) {
            return undefined;
        }

        while (message.length > 0) {
            var tlv = ns.decodeTLV(message);
            if (tlv.type === ns.TLV_TYPE.MESSAGE_TYPE) {
                return tlv.value.charCodeAt(0);
            }
            message = tlv.rest;
        }
        return undefined;
    };


    /**
     * Detects the type of a given message.
     *
     * @param message {string}
     *     A wire protocol message representation.
     * @returns {mpenc.codec.MESSAGE_TYPE}
     *     Object indicating message `type` and extracted message `content`.
     */
    ns.getMessageAndType = function(message) {
        if (!message) {
            return null;
        }

        // Check for plain text or "other".
        if (message.substring(0, _PROTOCOL_PREFIX.length) !== _PROTOCOL_PREFIX) {
            return { type: ns.MESSAGE_TYPE.PLAIN, content: message };
        }
        message = message.substring(_PROTOCOL_PREFIX.length);

        // Check for mpENC message.
        if ((message[0] === ':') && (message[message.length - 1] === '.')) {
            message = atob(message.substring(1, message.length - 1));
            var type = _getMessageType(message);
            if (type in ns.MESSAGE_TYPE_MAPPING) {
                return { type: type, content: message };
            }
        }

        _assert(false, 'Unknown mpENC message.');
    };


    /**
     * Encodes a given value to a binary TLV string of a given type.
     *
     * @param tlvType {integer}
     *     Type of string to use (16-bit unsigned integer).
     * @param value {string}
     *     A binary string of the pay load to carry. If omitted, no value
     *     (null) is used.
     * @returns {string}
     *     A binary TLV string.
     */
    ns.encodeTLV = function(tlvType, value) {
        if ((value === null) || (value === undefined)) {
            value = '';
        }
        value += '';
        var out = ns._short2bin(tlvType);
        out += ns._short2bin(value.length);
        return out + value;
    };


    /**
     * Encodes an array of values to a binary TLV string of a given type.
     *
     * @param tlvType {integer}
     *     Type of string to use (16-bit unsigned integer).
     * @param valueArray {Array}
     *     The array of values.
     * @returns {string}
     *     A binary TLV string.
     */
    ns._encodeTlvArray = function(tlvType, valueArray) {
        _assert((valueArray instanceof Array) || (valueArray === null),
                'Value passed neither an array or null.');

        // Trivial case, quick exit.
        if ((valueArray === null) || (valueArray.length === 0)) {
            return '';
        }

        var out = '';
        for (var i = 0; i < valueArray.length; i++) {
            out += ns.encodeTLV(tlvType, valueArray[i]);
        }
        return out;
    };


    /**
     * Encodes an mpENC TLV string suitable for sending onto the wire.
     */
    ns.tlvToWire = function(contents) {
        return _PROTOCOL_PREFIX + ':' + btoa(contents) + '.';
    };


    /**
     * Decodes an mpENC wire message into a TLV string.
     */
    ns.wireToTLV = function(wireMessage) {
        return atob(wireMessage.slice(_PROTOCOL_PREFIX.length + 1, -1));
    };


    /**
     * Encodes a given error message.
     *
     * @param error {object}
     *     Descriptor object for the error; must contain these properties:
     *     from: Participant ID of the sender;
     *     severity: Severity of the error message;
     *     message: Error text to include in the message.
     * @param privKey {string}
     *     Sender's (ephemeral) private signing key.
     * @param pubKey {string}
     *     Sender's (ephemeral) public signing key.
     * @returns {string}
     *     A TLV string.
     */
    ns.encodeErrorMessage = function(error, privKey, pubKey) {
        if (error === null || error === undefined) {
            return null;
        }

        var content = ns.ENCODED_VERSION + ns.ENCODED_TYPE_ERROR;
        content += ns.encodeTLV(ns.TLV_TYPE.SOURCE, error.from);
        if (!ns._ERROR_MAPPING[error.severity]) {
            throw new Error('Illegal error severity: ' + error.severity + '.');
        }
        content += ns.encodeTLV(ns.TLV_TYPE.SEVERITY, String.fromCharCode(error.severity));
        content += ns.encodeTLV(ns.TLV_TYPE.DATA_MESSAGE, error.message);

        if (privKey) {
            var signature = ns.signMessage(ns.MESSAGE_TYPE.MPENC_ERROR,
                                           content, privKey, pubKey);
            return ns.encodeTLV(ns.TLV_TYPE.MESSAGE_SIGNATURE, signature) + content;
        } else {
            return content;
        }
    };


    /**
     * Decodes a given error message.
     *
     * @param content {string}
     *     A TLV string.
     * @returns {object}
     *     The error descriptor object, documented in {@link #encodeMessage()}.
     *     Has the additional field `signatureOk` {?bool} (`true` if signature
     *     verifies, `false` if failed, `null` if signature does not exist or
     *     could not be verified).
     */
    ns.decodeErrorMessage = function(content, getPubKey) {
        var debugOutput = [];
        var out = {};
        out.signatureOk = null;
        var rest = content;

        rest = ns.popTLVMaybe(rest, ns.TLV_TYPE.MESSAGE_SIGNATURE, function(value) {
            out.signature = value;
        });
        if (out.signature) {
            out.signatureOk = ns.verifyMessageSignature(ns.MESSAGE_TYPE.MPENC_ERROR,
                                                        rest, out.signature, getPubKey(out.from));
        }

        rest = ns.popStandardFields(rest, ns.MESSAGE_TYPE.MPENC_ERROR);
        rest = ns.popTLV(rest, ns.TLV_TYPE.SOURCE, function(value) {
            out.from = value;
        });
        rest = ns.popTLV(rest, ns.TLV_TYPE.SEVERITY, function(value) {
            out.severity = value.charCodeAt(0);
        });
        rest = ns.popTLV(rest, ns.TLV_TYPE.DATA_MESSAGE, function(value) {
            out.message = value;
        });

        return out;
    };


    ns.errorToUiString = function(error) {
        var uiMessageString = ns._ERROR_MAPPING[error.severity];
        if (error.severity === ns.ERROR.TERMINAL) {
            uiMessageString += ' ERROR';
        }
        uiMessageString += ': ' + error.message;
        return uiMessageString;
    };


    /**
     * Converts an unsigned short integer to a binary string.
     *
     * @param value {integer}
     *     A 16-bit unsigned integer.
     * @returns {string}
     *     A two character binary string.
     */
    ns._short2bin = function(value) {
        return String.fromCharCode(value >> 8) + String.fromCharCode(value & 0xff);
    };


    /**
     * Converts a binary string to an unsigned short integer.
     *
     * @param value {string}
     *     A two character binary string.
     * @returns {integer}
     *     A 16-bit unsigned integer.
     */
    ns._bin2short = function(value) {
        return (value.charCodeAt(0) << 8) | value.charCodeAt(1);
    };


    /**
     * Signs a given data message with the ephemeral private key.
     *
     * This implementation is using the Edwards25519 for an ECDSA signature
     * mechanism to complement the Curve25519-based group key agreement.
     *
     * @param type {integer}
     *     Message type, one of {@see mpenc/codec.MESSAGE_TYPE}.
     * @param data {string}
     *     Binary string data message.
     * @param privKey {string}
     *     Binary string representation of the ephemeral private key.
     * @param pubKey {string}
     *     Binary string representation of the ephemeral public key.
     * @property sidkeyHash {string}
     *     On {MPENC_DATA_MESSAGE} relevant only. A hash value hinting at the
     *     right combination of session ID and group key used for a data message.
     * @returns {string}
     *     Binary string representation of the signature.
     */
    ns.signMessage = function(type, data, privKey, pubKey, sidkeyHash) {
        if (data === null || data === undefined) {
            return null;
        }
        var prefix = _MAGIC_NUMBERS[type];
        if (type === ns.MESSAGE_TYPE.MPENC_DATA_MESSAGE) {
            prefix += sidkeyHash;
        }
        return jodid25519.eddsa.sign(prefix + data, privKey, pubKey);
    };


    /**
     * Checks the signature of a given data message with the ephemeral public key.
     *
     * This implementation is using the Edwards25519 for an ECDSA signature
     * mechanism to complement the Curve25519-based group key agreement.
     *
     * @param type {integer}
     *     Message type, one of {@see mpenc/codec.MESSAGE_TYPE}.
     * @param data {string}
     *     Binary string data message.
     * @param signature {string}
     *     Binary string representation of the signature.
     * @param pubKey {string}
     *     Binary string representation of the ephemeral public key.
     * @property sidkeyHash {string}
     *     On {MPENC_DATA_MESSAGE} relevant only. A hash value hinting at the
     *     right combination of session ID and group key used for a data message.
     * @returns {bool}
     *     True if the signature verifies, false otherwise.
     */
    ns.verifyMessageSignature = function(type, data, signature, pubKey, sidkeyHash) {
        if (data === null || data === undefined) {
            return null;
        }
        var prefix = _MAGIC_NUMBERS[type];
        if (type === ns.MESSAGE_TYPE.MPENC_DATA_MESSAGE) {
            prefix += sidkeyHash;
        }
        return jodid25519.eddsa.verify(signature, prefix + data, pubKey);
    };


    ns.ENCODED_VERSION = ns.encodeTLV(ns.TLV_TYPE.PROTOCOL_VERSION, version.PROTOCOL_VERSION);
    ns.ENCODED_TYPE_DATA = ns.encodeTLV(ns.TLV_TYPE.MESSAGE_TYPE, String.fromCharCode(ns.MESSAGE_TYPE.MPENC_DATA_MESSAGE));
    ns.ENCODED_TYPE_GREET = ns.encodeTLV(ns.TLV_TYPE.MESSAGE_TYPE, String.fromCharCode(ns.MESSAGE_TYPE.MPENC_GREET_MESSAGE));
    ns.ENCODED_TYPE_QUERY = ns.encodeTLV(ns.TLV_TYPE.MESSAGE_TYPE, String.fromCharCode(ns.MESSAGE_TYPE.MPENC_QUERY));
    ns.ENCODED_TYPE_ERROR = ns.encodeTLV(ns.TLV_TYPE.MESSAGE_TYPE, String.fromCharCode(ns.MESSAGE_TYPE.MPENC_ERROR));
    ns.PROTOCOL_VERSION = version.PROTOCOL_VERSION;

    /**
     * String representing an mpENC query message.
     */
    ns.MPENC_QUERY_MESSAGE = ns.ENCODED_VERSION + ns.ENCODED_TYPE_QUERY;

    return ns;
});
