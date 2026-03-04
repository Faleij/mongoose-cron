'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const moment = require('moment');
const Cron = require('../lib/cron');

function createCron(config = {}) {
  return new Cron({}, {
    handler: () => {},
    nextDelay: config.nextDelay ?? 0,
    ...config
  });
}

function doc(overrides = {}) {
  return {
    cron: {
      interval: '0 0 3 * * *', // 03:00:00 daily
      startAt: new Date(),
      ...overrides.cron
    },
    ...overrides
  };
}

describe('getNextStart', () => {
  describe('non-recurring or missing interval', () => {
    it('returns null when doc.cron.interval is missing', () => {
      const cron = createCron();
      const d = doc({ cron: { startAt: new Date() } });
      delete d.cron.interval;
      assert.strictEqual(cron.getNextStart(d), null);
    });

    it('returns null when doc.cron.interval is null', () => {
      const cron = createCron();
      const d = doc({ cron: { interval: null, startAt: new Date() } });
      assert.strictEqual(cron.getNextStart(d), null);
    });

    it('returns null when doc.cron.interval is empty string', () => {
      const cron = createCron();
      const d = doc({ cron: { interval: '', startAt: new Date() } });
      assert.strictEqual(cron.getNextStart(d), null);
    });
  });

  describe('startAt already in the future', () => {
    it('returns existing startAt when startAt is after now', () => {
      const cron = createCron();
      const futureStart = moment().add(2, 'hours').toDate();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: futureStart } });
      const result = cron.getNextStart(d);
      assert.strictEqual(result.getTime(), futureStart.getTime());
    });

    it('returns existing startAt when startAt is at or after future boundary (nextDelay=0)', () => {
      const cron = createCron();
      const justAfterNow = moment().add(100, 'ms').toDate();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: justAfterNow } });
      const result = cron.getNextStart(d);
      assert.strictEqual(result.getTime(), justAfterNow.getTime());
    });

    it('when nextDelay is set, returns startAt only if startAt >= now + nextDelay', () => {
      const cron = createCron({ nextDelay: 60 * 60 * 1000 }); // 1 hour
      const oneHourFromNow = moment().add(1, 'hour').toDate();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: oneHourFromNow } });
      const result = cron.getNextStart(d);
      assert.strictEqual(result.getTime(), oneHourFromNow.getTime());
    });
  });

  describe('daily at 3:00 AM (0 0 3 * * *)', () => {
    it('returns next 3:00 AM (server local) as a Date', () => {
      const cron = createCron();
      const pastStart = moment().subtract(1, 'day').toDate();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: pastStart } });
      const result = cron.getNextStart(d);
      assert.ok(result instanceof Date);
      assert.strictEqual(moment(result).hours(), 3, 'next run at 3:00 server local');
      assert.strictEqual(moment(result).minutes(), 0);
      assert.strictEqual(moment(result).seconds(), 0);
    });

    it('returns next occurrence (today or tomorrow local) not the one after', () => {
      const cron = createCron();
      const pastStart = moment().subtract(2, 'days').toDate();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: pastStart } });
      const result = cron.getNextStart(d);
      const now = moment();
      const hour = now.hours();
      const expectedNext = hour < 3
        ? moment(now).hours(3).minutes(0).seconds(0).milliseconds(0)
        : moment(now).add(1, 'day').hours(3).minutes(0).seconds(0).milliseconds(0);
      assert.strictEqual(
        result.getTime(),
        expectedNext.valueOf(),
        'next run should be the immediate next 3:00 AM local, not the one after'
      );
    });
  });

  describe('hourly schedule', () => {
    it('returns next full hour (server local) when schedule is every hour at minute 0', () => {
      const cron = createCron();
      const d = doc({
        cron: {
          interval: '0 0 * * * *', // every hour at :00:00
          startAt: moment().subtract(1, 'hour').toDate()
        }
      });
      const result = cron.getNextStart(d);
      assert.ok(result instanceof Date);
      assert.strictEqual(moment(result).minutes(), 0);
      assert.strictEqual(moment(result).seconds(), 0);
      const now = moment();
      const expectedNext = moment(now).add(1, 'hour').minutes(0).seconds(0).milliseconds(0);
      assert.ok(
        Math.abs(result.getTime() - expectedNext.valueOf()) < 2000,
        'next run should be the next full hour local (within 2s)'
      );
    });
  });

  describe('nextDelay', () => {
    it('next run is at least now + nextDelay', () => {
      const nextDelayMs = 5 * 60 * 1000; // 5 minutes
      const cron = createCron({ nextDelay: nextDelayMs });
      const pastStart = moment().subtract(1, 'hour').toDate();
      const d = doc({ cron: { interval: '0 0 * * * *', startAt: pastStart } });
      const result = cron.getNextStart(d);
      const minAllowed = Date.now() + nextDelayMs - 1000; // 1s tolerance
      assert.ok(result.getTime() >= minAllowed, 'next start should be >= now + nextDelay');
    });
  });

  describe('stopAt', () => {
    it('returns null when stopAt is in the past (no more runs)', () => {
      const cron = createCron();
      const pastStop = moment().subtract(1, 'day').toDate();
      const d = doc({
        cron: {
          interval: '0 0 3 * * *',
          startAt: moment().subtract(2, 'days').toDate(),
          stopAt: pastStop
        }
      });
      const result = cron.getNextStart(d);
      assert.strictEqual(result, null);
    });

    it('returns next run when stopAt is in the future', () => {
      const cron = createCron();
      const futureStop = moment().add(7, 'days').toDate();
      const d = doc({
        cron: {
          interval: '0 0 3 * * *',
          startAt: moment().subtract(1, 'day').toDate(),
          stopAt: futureStop
        }
      });
      const result = cron.getNextStart(d);
      assert.ok(result instanceof Date);
      assert.ok(result.getTime() <= futureStop.getTime());
      assert.strictEqual(moment(result).hours(), 3);
      assert.strictEqual(moment(result).minutes(), 0);
    });
  });

  describe('error handling', () => {
    it('returns null when no next occurrence (e.g. stopAt past)', () => {
      const cron = createCron();
      const d = doc({
        cron: {
          interval: '0 0 3 * * *',
          startAt: moment().subtract(1, 'day').toDate(),
          stopAt: moment().subtract(2, 'days').toDate()
        }
      });
      assert.strictEqual(cron.getNextStart(d), null);
    });

    it('returns either null or a valid Date (never throws)', () => {
      const cron = createCron();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: moment().subtract(1, 'day').toDate() } });
      const result = cron.getNextStart(d);
      assert.ok(result === null || (result instanceof Date && !isNaN(result.getTime())));
    });
  });

  describe('specific time schedules', () => {
    it('every day at 12:30 (server local) returns 12:30 local', () => {
      const cron = createCron();
      const d = doc({
        cron: {
          interval: '0 30 12 * * *',
          startAt: moment().subtract(1, 'day').toDate()
        }
      });
      const result = cron.getNextStart(d);
      assert.strictEqual(moment(result).hours(), 12);
      assert.strictEqual(moment(result).minutes(), 30);
      assert.strictEqual(moment(result).seconds(), 0);
    });

    it('every minute returns a time within the next two minutes', () => {
      const cron = createCron();
      const d = doc({
        cron: {
          interval: '0 * * * * *', // every minute at :00 seconds
          startAt: moment().subtract(1, 'minute').toDate()
        }
      });
      const result = cron.getNextStart(d);
      const now = Date.now();
      const twoMinutes = 2 * 60 * 1000;
      assert.ok(result.getTime() >= now, 'next run should be in the future');
      assert.ok(result.getTime() <= now + twoMinutes, 'next run should be within 2 minutes');
    });
  });

  describe('timezone (cron.timezone)', () => {
    it('with timezone set, returns next run at that time in the given zone', () => {
      const cron = createCron();
      const pastStart = moment().subtract(1, 'day').toDate();
      const d = doc({
        cron: {
          interval: '0 0 3 * * *',
          startAt: pastStart,
          timezone: 'America/New_York'
        }
      });
      const result = cron.getNextStart(d);
      assert.ok(result instanceof Date);
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const parts = formatter.formatToParts(result);
      const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
      const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
      const second = parseInt(parts.find(p => p.type === 'second').value, 10);
      assert.strictEqual(hour, 3, 'next run should be 03:00 in America/New_York');
      assert.strictEqual(minute, 0);
      assert.strictEqual(second, 0);
    });

    it('respects stopAt when timezone is set (past stopAt returns null)', () => {
      const cron = createCron();
      const pastStop = moment().subtract(1, 'day').toDate();
      const d = doc({
        cron: {
          interval: '0 0 3 * * *',
          startAt: moment().subtract(2, 'days').toDate(),
          stopAt: pastStop,
          timezone: 'Europe/London'
        }
      });
      const result = cron.getNextStart(d);
      assert.strictEqual(result, null);
    });

    it('respects stopAt when timezone is set (future stopAt returns next run before it)', () => {
      const cron = createCron();
      const futureStop = moment().add(7, 'days').toDate();
      const d = doc({
        cron: {
          interval: '0 0 9 * * *',
          startAt: moment().subtract(1, 'day').toDate(),
          stopAt: futureStop,
          timezone: 'Europe/London'
        }
      });
      const result = cron.getNextStart(d);
      assert.ok(result instanceof Date);
      assert.ok(result.getTime() <= futureStop.getTime());
    });

    it('empty string timezone is treated as no timezone (server local)', () => {
      const cron = createCron();
      const pastStart = moment().subtract(1, 'day').toDate();
      const d = doc({ cron: { interval: '0 0 3 * * *', startAt: pastStart, timezone: '' } });
      const result = cron.getNextStart(d);
      assert.ok(result instanceof Date);
      assert.strictEqual(moment(result).hours(), 3);
      assert.strictEqual(moment(result).minutes(), 0);
    });

    it('invalid timezone returns null', () => {
      const cron = createCron();
      const d = doc({
        cron: {
          interval: '0 0 3 * * *',
          startAt: moment().subtract(1, 'day').toDate(),
          timezone: 'Invalid/Timezone'
        }
      });
      const result = cron.getNextStart(d);
      assert.strictEqual(result, null);
    });
  });
});
