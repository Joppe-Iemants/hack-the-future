import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoFriends} from '../dist/demo-friends.mjs';
import {decodePath} from '../dist/route-codec.mjs';

test('Firebase demo friends are a bounded fictional dataset with usable public routes', () => {
  const now = 1806060000000;
  const friends = createDemoFriends(now);
  assert.equal(Object.keys(friends).length, 3);
  assert.equal(Object.values(friends).filter(friend => friend.status === 'accepted').length, 2);
  assert.equal(friends['demo-yara'].status, 'pending');
  assert.ok(Buffer.byteLength(JSON.stringify(friends)) < 50000);
  for (const friend of Object.values(friends)) {
    assert.equal(friend.isDemo, true);
    assert.equal(friend.activities.length, 2);
    for (const activity of friend.activities) {
      assert.ok(activity.end <= now);
      assert.ok(activity.meters > 0);
      assert.ok(activity.lines.length > 0);
      assert.ok(activity.lines.every(line => decodePath(line).length > 1));
      assert.equal(activity.note, undefined);
      assert.equal(activity.audio, undefined);
      assert.equal(activity.path, undefined);
    }
  }
  assert.deepEqual(createDemoFriends(now), friends);
});
