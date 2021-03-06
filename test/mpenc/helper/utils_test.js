/**
 * @fileOverview
 * Tests for `mpenc/helper/utils` module.
 */

/*
 * Created: 7 Feb 2014 Guy K. Kloss <gk@mega.co.nz>
 *
 * (c) 2014-2016 by Mega Limited, Auckland, New Zealand
 *     https://mega.nz/
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
    "mpenc/helper/utils",
    "chai",
    "asmcrypto",
], function(ns, chai, asmCrypto) {
    "use strict";

    var assert = chai.assert;

    // Shut up warning messages on random number generation for unit tests.
    asmCrypto.random.skipSystemRNGWarning = true;

    describe("module level", function() {
        describe('_arrayIsSubSet()', function() {
            it('check for sub/superset between arrays', function() {
                var subset = ['1', '2', '3'];
                var superset = ['0', '1', '2', '3', '4'];
                assert.ok(ns._arrayIsSubSet(subset, superset));
                assert.strictEqual(ns._arrayIsSubSet(superset, subset), false);
            });
        });

        describe('_arrayIsSet()', function() {
            it('check for non-duplicatoin of members in array', function() {
                var theArray = ['1', '2', '3'];
                assert.ok(ns._arrayIsSet(theArray));
                assert.strictEqual(ns._arrayIsSet(['2'].concat(theArray)), false);
            });
        });

        describe('randomString()', function() {
            it('properly sized keys', function() {
                var keySizes = [128, 256, 512];
                for (var i = 0; i < keySizes.length; i++) {
                    var newKey = ns.randomString(keySizes[i] / 8);
                    assert.strictEqual(_tu.keyBits(newKey, 8), keySizes[i]);
                }
            });
        });

        describe('sha256()', function() {
            it('hash some values', function() {
                var values = ['42', "Don't panic!", 'Flying Spaghetti Monster',
                              "Ph'nglui mglw'nafh Cthulhu R'lyeh wgah'nagl fhtagn"];
                var expected = ['c0dctApWjo2ooEXO0RATfhWfiQrE2og7axfcZRs6gEk=',
                                'TmLsTicvHVMesbDSYdkglep+nRe3N4zjd/9M9hzt4K8=',
                                '7yxZ7NbTWc3tm0ls0sEFmuzoE+r0rLmVvnIwI7obFdo=',
                                'O19HQMj+HOz9y3uUBDS4uG8GPXYmZmAUj8ZLVQEFxzY='];
                for (var i = 0; i < values.length; i++) {
                    var result = ns.sha256(values[i]);
                    assert.strictEqual(result, atob(expected[i]));
                }
            });
        });

        describe('constTimeStringCmp()', function() {
            it('tests for equality', function() {
                var tests = [['', ''],
                             ['\u0000', '\u0000'],
                             [_td.ED25519_PUB_KEY, _td.ED25519_PUB_KEY],
                             ["Duck's stuck!", "Duck's Stuck!"],
                             ['42', '42']];
                for (var i = 0; i < tests.length; i++) {
                    assert.ok(ns.constTimeStringCmp(tests[0][0], tests[0][1]),
                              'case ' + (i + 1));
                }
            });

            it('tests for inequality', function() {
                var tests = [['', '\u0000'],
                             ['\u0000', '\u0001'],
                             [_td.ED25519_PUB_KEY, _td.ED25519_PRIV_KEY],
                             ["Duck's stuck!", "Duck's Stuck"],
                             ["Duck's stuck", "Duck's Stuck!"],
                             ['42', '43']];
                for (var i = 0; i < tests.length; i++) {
                    assert.notOk(ns.constTimeStringCmp(tests[0][0], tests[0][1]),
                                 'case ' + (i + 1));
                }
            });
        });
    });

    describe("StateMachine test", function() {
        var StateChange = function(newState, oldState) {
            this.newState = newState;
            this.oldState = oldState;
        };

        it('ctor', function() {
            var s = new ns.StateMachine(StateChange, 0);
            assert.strictEqual(s.state(), 0);
        });
        it('#setState()', function() {
            var s = new ns.StateMachine(StateChange, 0);
            var sns = s.setState(1);
            assert.strictEqual(s.state(), 1);
            assert.strictEqual(sns.oldState, 0);
            assert.strictEqual(sns.newState, 1);
        });
    });

});
