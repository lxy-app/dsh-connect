import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  SessionEventsPage as TargetEventsPage,
  SessionPageRequest as TargetPageRequest,
  SessionSummary as TargetSessionSummary,
} from '@deepseek-ai/dsh-api-session-controller';
import type { SessionPage, SessionPageRequest, SessionSummary } from '../src/host-api.js';
import { pageInput } from '../src/lib/input-validation.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends (<Value>() => Value extends Right ? 1 : 2)
    ? ((<Value>() => Value extends Right ? 1 : 2) extends (<Value>() => Value extends Left ? 1 : 2) ? true : false)
    : false;
type Assert<Value extends true> = Value;

/** Compile-time guards against drifting from the published history DTO. */
export type Rc5PageCutMatches = Assert<Equal<
  Pick<SessionPageRequest, 'throughSeq'>,
  Pick<TargetPageRequest, 'throughSeq'>
>>;
export type Rc5PageCursorMatches = Assert<Equal<
  Pick<SessionPage, 'cursor'>,
  Pick<TargetEventsPage, 'cursor'>
>>;
export type Rc5SummaryRemainsReadable = Assert<TargetSessionSummary extends SessionSummary ? true : false>;

test('rc5 Host history DTO keeps an optional request cut and required response cursor', () => {
  const request = pageInput({ sessionId: 'session-1' });
  assert.equal(request.throughSeq, undefined);

  const targetPage: TargetEventsPage = { cursor: 0, records: [], hasMore: false };
  const page: SessionPage = targetPage;
  assert.equal(page.cursor, 0);
});
