/*
 * Created: 30 Mar 2015 Ximin Luo <xl@mega.co.nz>
 *
 * (c) 2015 by Mega Limited, Auckland, New Zealand
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
    "mpenc/helper/struct",
    "es6-collections",
    "megalogger"
], function(struct, es6_shim, MegaLogger) {
    "use strict";

    /**
     * @exports mpenc/helper/async
     * @description
     * Utilities for asynchronous programming.
     */
    var ns = {};

    var logger = MegaLogger.getLogger("async");

    /**
     * 0-arg function to cancel a subscription; does not throw an exception.
     *
     * @callback canceller
     * @returns {boolean} <code>false</code> if already cancelled, otherwise
     *     <code>true</code>.
     */

    /**
     * 1-arg function to handle items published as part of a subscription.
     *
     * @callback subscriber
     * @param item {object} The published item
     * @returns {object} An optional "status" to give back to the publisher.
     *      See {module:mpenc/helper/async.Observable#publish} for details.
     */

    /**
     * 1-arg function for registering subscribers to future published items.
     *
     * @callback subscribe
     * @param subscriber {module:mpenc/helper/async~subscriber}
     * @returns canceller {module:mpenc/helper/async~canceller}
     * @see module:mpenc/helper/async.Observable
     * @see module:mpenc/helper/async.Observable#subscribe
     */


    /**
     * A subscribe-function with child tweaked subscribe-functions.
     *
     * This is not instantiable directly; use Subscribe.wrap() instead.
     *
     * @class
     * @memberOf! module:mpenc/helper/async
     */
    var Subscribe = function() {
        throw new Error("cannot instantiate; use Subscribe.wrap() instead.");
    };

    /**
     * Decorate a plain subscribe-function with child tweaks.
     *
     * @param subscribe {module:mpenc/helper/async~subscribe}
     * @returns {module:mpenc/helper/async~subscribe}
     */
    Subscribe.wrap = function(subscribe) {
        // a slight hack here to support some nicer syntax for clients
        if (Object.setPrototypeOf) {
            Object.setPrototypeOf(subscribe, Subscribe.prototype);
        } else {
            subscribe.__proto__ = Subscribe.prototype;
        }
        Object.freeze(subscribe);
        return subscribe;
    };

    Subscribe.prototype = Object.create(Function.prototype);

    /**
     * A subscribe-function that registers once-only subscriptions.
     *
     * As soon as an item is published to the subscription, it is cancelled and
     * no more items are published to it.
     *
     * @member
     * @type {module:mpenc/helper/async~subscribe}
     */
    Subscribe.prototype.once = function(sub) {
        var cancel;
        var wrapped_sub = function(item) {
            cancel();
            return sub(item);
        };
        cancel = this(wrapped_sub);
        return cancel;
    };

    Object.freeze(Subscribe.prototype);
    ns.Subscribe = Subscribe;


    /**
     * An Observable.
     *
     * This is used generally to implement asynchronous pipelines, where you
     * want to pass items to unspecified components, but are not directly
     * interested in getting a response back for each items you pass on. This
     * is in contrast to Future/Promise, whose purpose is to represent any
     * eventual response or lack of it.
     *
     * It is recommended for the publisher (the entity that created/owns this
     * object), to make sub(), the "read capability", accessible to clients,
     * but keep pub(), the "write capability", private. This pattern is also
     * found in many Future-Promise designs.
     *
     * If a subscription is registered during the publishing of an item on the
     * same Observable, it will *not* be fired in the current publishing, and
     * will not receive the item. However if a subscription is cancelled during
     * this time, then it will not be fired either, even if it was due to be
     * fired later. (This is identical to how events are handled on browsers.)
     *
     * @class
     * @param {boolean} require_subs Elements of the set
     * @memberOf! module:mpenc/helper/async
     */
    var Observable = function(require_subs) {
        if (!(this instanceof Observable)) {
            return new Observable(require_subs);
        }

        var _subs = new Map();
        var _subn = 0;
        var _require_subs = require_subs;

        /**
         * Subscribe to new items published in the future.
         *
         * The same subscriber function may be registered multiple times; each
         * registration is treated as a *separate* subscription, to be fired
         * and/or cancelled individually.
         *
         * @method
         * @param subscriber {module:mpenc/helper/async~subscriber}
         * @returns canceller {module:mpenc/helper/async~canceller}
         */
        this.subscribe = Subscribe.wrap(function(sub) {
            _subs.set(_subn, sub);
            var k = _subn;
            _subn += 1;
            return function() {
                return _subs.delete(k);
            };
        });

        /**
         * Publish an item to all subscriptions.
         *
         * Subscriptions are fired in the order in which they were registered.
         *
         * @returns status {Array} An array of status objects that each
         *      subscriber returned. The semantics of these objects is defined
         *      by the publisher, who should make this clear in its contract.
         *      Typically, this could just be a boolean that represents whether
         *      the published item was accepted by the subscriber. It should
         *      probably *not* represent the "result" of any operation, even as
         *      a Future[result], since this class is designed for situations
         *      where the publisher doesn't care about such things.
         */
        this.publish = function(item) {
            if (_require_subs && !_subs.size) {
                throw new Error("published item with no subscriber: " + item);
            }
            var copy = new Map(struct.iteratorToArray(_subs.entries())); // should just be new Map(_subs) in ES6
            var status = [];
            copy.forEach(function(sub, k) {
                if (!_subs.has(k)) return; // don't call if removed by previous sub
                try {
                    status.push(sub(item));
                } catch (e) {
                    __SubscriberFailure_publishGlobal(sub, item, e);
                    status.push(undefined);
                }
            });
            return status;
        };

        this.size = function() {
            return _subs.size;
        };
    };
    ns.Observable = Observable;


    /**
     * A subscriber failed to handle an item or event.
     *
     * @class
     * @memberOf! module:mpenc/helper/async
     */
    var SubscriberFailure = function(sub, item, error) {
        if (!(this instanceof SubscriberFailure)) {
            return new SubscriberFailure(sub, item, error);
        }
        this.sub = sub;
        this.item = item;
        this.error = error;
    };

    var __SubscriberFailure_global = new Observable();

    var __SubscriberFailure_publishGlobal = function(sub, item, error) {
        if (item instanceof SubscriberFailure) {
            logger.log(MegaLogger.LEVELS.WARN, "swallowed recursive SubscriberFailure: " + sub + ", " + item + ", " + error);
        } else {
            __SubscriberFailure_global.publish(new SubscriberFailure(sub, item, error));
        }
    };

    /**
     * Subscribe to all subscriber failures in the entire program.
     */
    SubscriberFailure.subscribeGlobal = __SubscriberFailure_global.subscribe;

    /**
     * Stop logging all subscriber failures in the entire program.
     */
    SubscriberFailure.cancelGlobalLog = __SubscriberFailure_global.subscribe(function(f) {
        logger.warn("subscriber (" + f.sub + ") failed on (" + f.item + "): " + f.error)
        logger.debug(f.error.stack);
    });

    ns.SubscriberFailure = SubscriberFailure;


    /**
     * Combine several cancellers into a single canceller.
     *
     * @param cancels {module:mpenc/helper/async~canceller[]}
     * @returns {module:mpenc/helper/async~canceller}
     * @memberOf! module:mpenc/helper/async
     */
    var combinedCancel = function(cancels) {
        return function() {
            var retval = false;
            var error = null;
            for (var i=0; i<cancels.length; i++) {
                var c = cancels[i];
                try {
                    retval |= c();
                } catch (e) {
                    // not supposed to throw, but if it does, we make sure
                    // everything else is still cancelled
                    error = e;
                }
            }
            if (error !== null) {
                throw error;
            } else {
                return retval;
            }
        };
    };
    ns.combinedCancel = combinedCancel;

    return ns;
});
