'use strict';
/* Student-facing strings. Language comes from the content pack (server tells us). */
const I18N = {
  en: {
    reconnecting: 'Connection lost — reconnecting…',
    roomCode: 'Room code',
    yourName: 'Your name or nickname',
    joinGame: 'Join the game',
    youAreIn: "You're in! 🎉",
    pendingNote: "You'll join at the next round.",
    waitForTeacher: 'Waiting for your teacher to start…',
    round: 'Round',
    lockIn: 'Lock it in',
    lockedIn: '✓ Locked in — waiting for the others…',
    doublePoints: 'Play my ×2 token on this one',
    paused: '⏸ Paused',
    pausedNote: 'Your teacher paused the game. Nothing is lost.',
    roundOver: 'Round over',
    correctAnswerWas: 'Correct answer:',
    nextSoon: 'Next round starts when your teacher is ready…',
    gameOver: "That's the game! 🏁",
    send: 'Send',
    thanks: 'Thank you! You can close this page.',
    correct: 'Correct!',
    partly: 'Close — half credit!',
    wrong: 'Not this one.',
    points: 'points',
    yourAnswer: 'Your answer:',
    noAnswer: "Time ran out before you answered — it happens!",
    you: 'You',
    streak: 'streak',
    hintBetween: 'Hint: somewhere between {lo} and {hi}',
    scaffoldNote: 'One option removed for you 🤫',
    teamAvg: 'team avg',
    score: 'Score',
    answered: 'Answered',
    bestStreak: 'Best streak',
    kicked: 'Your teacher removed you from this session.',
    badRoom: 'That room code does not match this game.',
    finishing: 'This session is finishing — ask your teacher.',
    joinFailed: 'Could not join — check the code and try again.',
  },
  uk: {
    reconnecting: "Зв'язок втрачено — перепідключення…",
    roomCode: 'Код кімнати',
    yourName: "Ім'я або нікнейм",
    joinGame: 'Приєднатися до гри',
    youAreIn: 'Ти в грі! 🎉',
    pendingNote: 'Ти долучишся з наступного раунду.',
    waitForTeacher: 'Чекаємо, поки вчитель розпочне…',
    round: 'Раунд',
    lockIn: 'Відповісти',
    lockedIn: '✓ Прийнято — чекаємо інших…',
    doublePoints: 'Зіграти мій жетон ×2 на цьому питанні',
    paused: '⏸ Пауза',
    pausedNote: 'Вчитель призупинив гру. Нічого не втрачено.',
    roundOver: 'Раунд завершено',
    correctAnswerWas: 'Правильна відповідь:',
    nextSoon: 'Наступний раунд почнеться, коли вчитель буде готовий…',
    gameOver: 'Гру завершено! 🏁',
    send: 'Надіслати',
    thanks: 'Дякуємо! Можеш закрити цю сторінку.',
    correct: 'Правильно!',
    partly: 'Майже — половина балів!',
    wrong: 'Не ця відповідь.',
    points: 'балів',
    yourAnswer: 'Твоя відповідь:',
    noAnswer: 'Час вийшов до відповіді — буває!',
    you: 'Ти',
    streak: 'серія',
    hintBetween: 'Підказка: десь між {lo} та {hi}',
    scaffoldNote: 'Один варіант прибрано для тебе 🤫',
    teamAvg: 'середнє команди',
    score: 'Бали',
    answered: 'Відповідей',
    bestStreak: 'Найдовша серія',
    kicked: 'Вчитель видалив тебе з цієї сесії.',
    badRoom: 'Цей код кімнати не підходить до цієї гри.',
    finishing: 'Сесія завершується — запитай учителя.',
    joinFailed: 'Не вдалося приєднатися — перевір код і спробуй ще раз.',
  },
};

let LANG = (navigator.language || 'en').slice(0, 2);
if (!I18N[LANG]) LANG = 'en';

function t(key, vars) {
  let s = (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

function setLang(lang) {
  const short = (lang || 'en').slice(0, 2);
  if (I18N[short]) LANG = short;
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
}
