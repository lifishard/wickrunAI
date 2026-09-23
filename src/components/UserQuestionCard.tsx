import React from 'react';
import { useT } from '../lib/i18n';
import {
  USER_QUESTION_LIMITS,
  type UserQuestion,
  type UserQuestionAnswers,
  type UserQuestionRequest,
  validateUserAnswers,
} from '../lib/user-questions';
import './UserQuestionCard.css';
import { createQuestionDraft } from '../lib/question-draft';

export interface UserQuestionCardProps {
  request: UserQuestionRequest;
  answers?: UserQuestionAnswers;
  draft?: UserQuestionAnswers;
  disabled?: boolean;
  onSubmit: (answers: UserQuestionAnswers) => void;
  onDraft?: (answers: UserQuestionAnswers) => void;
}

function copyAnswer(answer: unknown): { selected: string[]; text: string } {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer)) return { selected: [], text: '' };
  const value = answer as { selected?: unknown; text?: unknown };
  return {
    selected: Array.isArray(value.selected)
      ? value.selected.filter((item): item is string => typeof item === 'string')
      : [],
    text: typeof value.text === 'string' ? value.text : '',
  };
}

function answerFor(answers: UserQuestionAnswers | undefined, questionId: string): { selected: string[]; text: string } {
  return copyAnswer(answers?.[questionId]);
}

function answerSignature(answers: UserQuestionAnswers | undefined, questions: UserQuestion[]): string {
  if (!answers) return '';
  return questions
    .map((question) => {
      const answer = answerFor(answers, question.id);
      return `${question.id}\u0000${answer.selected.join('\u0001')}\u0000${answer.text}`;
    })
    .join('\u0002');
}

function normalizedDraft(request: UserQuestionRequest, draft?: UserQuestionAnswers): UserQuestionAnswers {
  const result: UserQuestionAnswers = {};
  request.questions.forEach((question) => {
    const answer = answerFor(draft, question.id);
    const allowed = new Set(question.options.map((option) => option.label));
    const selected = [...new Set(answer.selected.filter((label) => allowed.has(label)))];
    result[question.id] = {
      selected: question.multiple ? selected : selected.slice(0, 1),
      // Keep the draft exactly as typed.  Validation normalizes the submitted
      // value; trimming here makes trailing spaces disappear while the user is
      // still composing and can make the controlled textarea jump.
      text: answer.text.slice(0, USER_QUESTION_LIMITS.answerText),
    };
  });
  return result;
}

function domToken(value: string): string {
  const token = value.replace(/[^a-zA-Z0-9_-]/g, '-');
  return token || 'question';
}

function displayAnswer(
  question: UserQuestion,
  answers: UserQuestionAnswers | undefined,
): { selected: string[]; text: string } {
  const answer = answerFor(answers, question.id);
  const allowed = new Set(question.options.map((option) => option.label));
  return {
    selected: [...new Set(answer.selected.filter((label) => allowed.has(label)))],
    text: answer.text.trim(),
  };
}

function QuestionPrompt({ question }: { question: UserQuestion }) {
  const t = useT();
  return (
    <>
      {question.header ? <span className="user-question-card__header-line">{question.header}</span> : null}
      <span className="user-question-card__prompt">{question.question}</span>
    </>
  );
}

function AnsweredCard({ request, answers }: { request: UserQuestionRequest; answers: UserQuestionAnswers }) {
  const t = useT();
  return (
    <section className="user-question-card user-question-card--answered" aria-label={t('问题回答')}>
      <div className="user-question-card__topline">
        <div>
          <h2 className="user-question-card__title">{t('问题回答')}</h2>
          <p className="user-question-card__hint">{t('以下内容已保存到当前会话。')}</p>
        </div>
        <span className="user-question-card__count">{t('{n} 个问题', { n: request.questions.length })}</span>
      </div>
      <ol className="user-question-card__answered-list">
        {request.questions.map((question) => {
          const answer = displayAnswer(question, answers);
          return (
            <li key={question.id} className="user-question-card__answered-item">
              <div className="user-question-card__answered-prompt">
                <QuestionPrompt question={question} />
              </div>
              {answer.selected.length ? (
                <p className="user-question-card__answer-line">
                  <span className="user-question-card__answer-label">{t('选择：')}</span>
                  {answer.selected.join('、')}
                </p>
              ) : null}
              {answer.text ? (
                <p className="user-question-card__answer-line user-question-card__answer-line--text">
                  <span className="user-question-card__answer-label">{t('补充回答：')}</span>
                  <span className="user-question-card__answer-text">{answer.text}</span>
                </p>
              ) : null}
              {!answer.selected.length && !answer.text ? (
                <p className="user-question-card__empty-answer">{t('未提供回答')}</p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function UserQuestionCard(props: UserQuestionCardProps) {
  // A different question starts a separate editor; its cleanup saves only the
  // old question's draft, never through the new question's callback.
  const identity = JSON.stringify([props.request.id, props.request.questions.map(q => q.id)]);
  return <QuestionEditor key={identity} {...props} />;
}

function QuestionEditor({
  request,
  answers,
  draft,
  disabled = false,
  onSubmit,
  onDraft,
}: UserQuestionCardProps) {
  const t = useT();
  const [localAnswers, setLocalAnswers] = React.useState<UserQuestionAnswers>(() => normalizedDraft(request, draft));
  const [error, setError] = React.useState('');
  const draftSink = React.useRef(onDraft);
  draftSink.current = onDraft;
  const [buffer] = React.useState(() => createQuestionDraft(localAnswers, value => draftSink.current?.(value)));
  const draftSignature = React.useMemo(() => answerSignature(draft, request.questions), [draft, request.questions]);
  const inputPrefix = `user-question-${domToken(request.id)}`;

  React.useEffect(() => {
    const next = normalizedDraft(request, draft);
    if (buffer.receive(next)) setLocalAnswers(next);
  }, [draftSignature, buffer]);

  React.useEffect(() => {
    const flush = () => buffer.flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('wickrun:flush-draft', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('wickrun:flush-draft', flush);
      buffer.dispose();
    };
  }, [buffer]);
  React.useEffect(() => { if (answers !== undefined) buffer.submitted(); }, [answers, buffer]);

  if (answers !== undefined) return <AnsweredCard request={request} answers={answers} />;

  const updateAnswer = (question: UserQuestion, next: { selected: string[]; text: string }) => {
    const nextAnswers: UserQuestionAnswers = {
      ...buffer.current(),
      [question.id]: {
        selected: [...next.selected],
        text: next.text,
      },
    };
    buffer.update(nextAnswers);
    setLocalAnswers(nextAnswers);
    setError('');
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled || buffer.isComposing()) return;
    try {
      const valid = validateUserAnswers(request, buffer.current());
      setError('');
      buffer.submitted();
      onSubmit(valid);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('回答无效，请检查后重试'));
    }
  };

  return (
    <section className="user-question-card" aria-label={t('待回答问题')}>
      <div className="user-question-card__topline">
        <div>
          <h2 className="user-question-card__title">{t('请回答以下问题')}</h2>
          <p className="user-question-card__hint">{t('选择一项或多项，也可以填写补充回答。')}</p>
        </div>
        <span className="user-question-card__count">{t('{n} 个问题', { n: request.questions.length })}</span>
      </div>

      <form className="user-question-card__form" noValidate onSubmit={handleSubmit}>
        {request.questions.map((question, questionIndex) => {
          const answer = answerFor(localAnswers, question.id);
          const legendId = `${inputPrefix}-legend-${questionIndex}`;
          const groupId = `${inputPrefix}-group-${questionIndex}`;
          const textId = `${inputPrefix}-text-${questionIndex}`;
          const textRequired = question.options.length === 0;
          return (
            <fieldset key={question.id} className="user-question-card__question">
              <legend id={legendId} className="user-question-card__legend">
                <QuestionPrompt question={question} />
              </legend>

              {question.options.length ? (
                <div
                  id={groupId}
                  className="user-question-card__options"
                  role={question.multiple ? 'group' : 'radiogroup'}
                  aria-labelledby={legendId}
                >
                  {question.options.map((option, optionIndex) => {
                    const optionId = `${inputPrefix}-option-${questionIndex}-${optionIndex}`;
                    const checked = answer.selected.includes(option.label);
                    return (
                      <label key={option.label} className={`user-question-card__option${checked ? ' is-selected' : ''}`} htmlFor={optionId}>
                        <input
                          id={optionId}
                          type={question.multiple ? 'checkbox' : 'radio'}
                          name={`${inputPrefix}-choice-${questionIndex}`}
                          value={option.label}
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) => {
                            const selected = question.multiple
                              ? event.target.checked
                                ? [...answer.selected, option.label]
                                : answer.selected.filter((label) => label !== option.label)
                              : event.target.checked
                                ? [option.label]
                                : [];
                            updateAnswer(question, { selected, text: answer.text });
                          }}
                        />
                        <span className="user-question-card__option-copy">
                          <span className="user-question-card__option-label">{option.label}</span>
                          {option.description ? (
                            <span className="user-question-card__option-description">{option.description}</span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}

              <div className="user-question-card__text-field">
                <label className="user-question-card__text-label" htmlFor={textId}>
                  {t('补充回答')}{question.options.length ? t('（可选）') : ''}
                </label>
                <textarea
                  id={textId}
                  aria-describedby={question.options.length ? groupId : undefined}
                  aria-required={textRequired}
                  value={answer.text}
                  disabled={disabled}
                  maxLength={USER_QUESTION_LIMITS.answerText}
                  rows={3}
                  placeholder={textRequired ? t('请填写回答') : t('可以补充说明')}
                  onChange={(event) => updateAnswer(question, { selected: answer.selected, text: event.target.value })}
                  onCompositionStart={() => buffer.composition(true)}
                  onCompositionEnd={(event) => {
                    updateAnswer(question, { selected: answerFor(buffer.current(), question.id).selected, text: event.currentTarget.value });
                    buffer.composition(false);
                  }}
                  onBlur={() => buffer.flush()}
                />
              </div>
            </fieldset>
          );
        })}

        <div className="user-question-card__footer">
          <p className="user-question-card__status" aria-live="polite">
            {error || t('每个问题都需要选择或填写回答。')}
          </p>
          <button className="btn sm primary" type="submit" disabled={disabled}>
            {t('提交回答')}
          </button>
        </div>
      </form>
    </section>
  );
}
