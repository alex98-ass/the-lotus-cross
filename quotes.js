// Quotes for the half-hour rotation.
// Every line is either public domain (KJV, Müller's Dhammapada, Arnold's Gita,
// Legge's Tao Te Ching, Whinfield's Rumi) or written for this site and
// attributed to it. Nothing here is a verse we could not name a source for.
//
// Rotation: one slot = 30 minutes. index = slot % pool.length, so a pool of 24
// covers twelve waking hours without a single repeat, then starts again.

// One tradition per calendar day, cycling in this order:
// Christianity → Buddhism → Hinduism → Taoism → Sufism → Mystics → Practice.
// Today (20 October 2026) begins the cycle on Christianity; change DAY_OFFSET
// by 1 and the whole wheel moves one day.
const ORDER = ['christianity', 'buddhism', 'hinduism', 'taoism', 'sufism', 'mystics', 'practice'];
const DAY_OFFSET = 1;

const THEMES = {};

const LABELS = {
  christianity: 'Christianity',
  buddhism: 'Buddhism',
  hinduism: 'Hinduism',
  taoism: 'Taoism',
  sufism: 'Sufism',
  mystics: 'The Mystics',
  practice: 'The Practice'
};

const QUOTES = {
  christianity: [
    { t: 'Be still, and know that I am God.', s: 'Psalm 46:10, KJV' },
    { t: 'The kingdom of God is within you.', s: 'Luke 17:21, KJV' },
    { t: 'Ask, and it shall be given you; seek, and ye shall find.', s: 'Matthew 7:7, KJV' },
    { t: 'Blessed are the pure in heart: for they shall see God.', s: 'Matthew 5:8, KJV' },
    { t: 'Love your enemies, bless them that curse you.', s: 'Matthew 5:44, KJV' },
    { t: 'I live; yet not I, but Christ liveth in me.', s: 'Galatians 2:20, KJV' },
    { t: 'Faith is the substance of things hoped for, the evidence of things not seen.', s: 'Hebrews 11:1, KJV' },
    { t: 'God is love; and he that dwelleth in love dwelleth in God.', s: '1 John 4:16, KJV' },
    { t: 'Be not conformed to this world: but be ye transformed by the renewing of your mind.', s: 'Romans 12:2, KJV' },
    { t: 'The Lord is my shepherd; I shall not want.', s: 'Psalm 23:1, KJV' },
    { t: 'Except a corn of wheat fall into the ground and die, it abideth alone.', s: 'John 12:24, KJV' },
    { t: 'In my Father\u2019s house are many mansions.', s: 'John 14:2, KJV' },
    { t: 'He that is without sin among you, let him first cast a stone.', s: 'John 8:7, KJV' },
    { t: 'Where two or three are gathered together in my name, there am I in the midst of them.', s: 'Matthew 18:20, KJV' },
    { t: 'Take therefore no thought for the morrow.', s: 'Matthew 6:34, KJV' },
    { t: 'The wind bloweth where it listeth, and thou hearest the sound thereof, but canst not tell whence it cometh.', s: 'John 3:8, KJV' },
    { t: 'Man shall not live by bread alone.', s: 'Matthew 4:4, KJV' },
    { t: 'The meek shall inherit the earth.', s: 'Psalm 37:11, KJV' },
    { t: 'Create in me a clean heart, O God; and renew a right spirit within me.', s: 'Psalm 51:10, KJV' },
    { t: 'He that is greatest among you shall be your servant.', s: 'Matthew 23:11, KJV' },
    { t: 'What shall it profit a man, if he shall gain the whole world, and lose his own soul?', s: 'Mark 8:36, KJV' },
    { t: 'Suffer the little children to come unto me, and forbid them not.', s: 'Mark 10:14, KJV' },
    { t: 'The light shineth in darkness; and the darkness comprehended it not.', s: 'John 1:5, KJV' },
    { t: 'Judge not, that ye be not judged.', s: 'Matthew 7:1, KJV' },
    { t: 'Though I speak with the tongues of men and of angels, and have not charity, I am become as sounding brass.', s: '1 Corinthians 13:1, KJV' },
    { t: 'Now we see through a glass, darkly; but then face to face.', s: '1 Corinthians 13:12, KJV' }
  ],

  buddhism: [
    { t: 'All that we are is the result of what we have thought.', s: 'Dhammapada 1, trans. M\u00fcller' },
    { t: 'Hatred is never appeased by hatred in this world; by love alone is hatred appeased.', s: 'Dhammapada 5, trans. M\u00fcller' },
    { t: 'He who holds back rising anger like a rolling chariot, him I call a real driver.', s: 'Dhammapada 222, trans. M\u00fcller' },
    { t: 'Victory breeds hatred, for the defeated live in pain.', s: 'Dhammapada 201, trans. M\u00fcller' },
    { t: 'Health is the greatest gift, contentment the greatest wealth, a trusted friend the best relation.', s: 'Dhammapada 204, trans. M\u00fcller' },
    { t: 'Let no one forget his own duty for the sake of another\u2019s, however great.', s: 'Dhammapada 166, trans. M\u00fcller' },
    { t: 'Drop by drop is the water pot filled. Likewise the wise man, gathering it little by little, fills himself with good.', s: 'Dhammapada 122, trans. M\u00fcller' },
    { t: 'Do not speak harshly to anybody; those who are spoken to will answer thee in the same way.', s: 'Dhammapada 133, trans. M\u00fcller' },
    { t: 'As a solid rock is not shaken by the wind, so the wise are not moved by praise or blame.', s: 'Dhammapada 81, trans. M\u00fcller' },
    { t: 'Better than a thousand hollow words is one word that brings peace.', s: 'Dhammapada 100, trans. M\u00fcller' },
    { t: 'If thou findest no companion, walk alone.', s: 'Dhammapada 329, trans. M\u00fcller' },
    { t: 'Conquer anger by love, evil by good, the liar by truth.', s: 'Dhammapada 223, trans. M\u00fcller' },
    { t: 'From affection comes grief, from affection comes fear.', s: 'Dhammapada 214, trans. M\u00fcller' },
    { t: 'Heedfulness is the path of life; heedlessness is the path of death.', s: 'Dhammapada 21, trans. M\u00fcller' },
    { t: 'Do not pursue the past. Do not lose yourself in the future. The past no longer is; the future has not yet come.', s: 'Bhaddekaratta Sutta' },
    { t: 'However many holy words you read, however many you speak, what good will they do you if you do not act upon them?', s: 'Dhammapada 19, trans. M\u00fcller' },
    { t: 'The scent of flowers does not travel against the wind, but the fragrance of the good spreads in all directions.', s: 'Dhammapada 54, trans. M\u00fcller' },
    { t: 'Let go of the past, let go of the future, let go of the present, and cross over to the farther shore.', s: 'Dhammapada 348, trans. M\u00fcller' },
    { t: 'Not to do any evil, to cultivate good, to purify one\u2019s mind — this is the teaching of the awakened.', s: 'Dhammapada 183, trans. M\u00fcller' },
    { t: 'As a water-pot filled to the brim is not shaken, so the mind of one who is full is steady.', s: 'Dhammapada 50, trans. M\u00fcller' },
    { t: 'Breathing in, I calm my body. Breathing out, I smile.', s: 'Thich Nhat Hanh' },
    { t: 'The mind is everything. What you think, you become.', s: 'Dhammapada, on thought' },
    { t: 'Thousands of candles can be lighted from a single candle, and the life of the candle will not be shortened.', s: 'the Buddhist tradition' },
    { t: 'The trouble is, you think you have time.', s: 'the Buddhist tradition' },
    { t: 'Whatever is subject to arising is subject to cessation.', s: 'the Buddhist tradition' },
    { t: 'Let no one deceive another, let no one despise any being anywhere.', s: 'Dhammapada 122, the Metta Sutta' }
  ],

  hinduism: [
    { t: 'Be thou absorbed in the work, and be thou unperplexed in success and failure. Yoga is called evenness of mind.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'He who is free from desire, and whose mind is at peace, finds peace in the self.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'As a lamp in a windless place does not flicker — such is the steady mind of the contemplative.', s: 'Bhagavad Gita 6, trans. Arnold' },
    { t: 'That which is not may never be, nor may that which is cease to be.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'Change is the law of the universe.', s: 'Bhagavad Gita, the tradition' },
    { t: 'The soul is neither born, nor does it ever die; what is born will surely die, and what has died will surely be reborn.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'When meditation is mastered, the mind is unwavering like the flame of a lamp in a windless place.', s: 'Bhagavad Gita 6, trans. Arnold' },
    { t: 'The senses are superior to the body; the mind is superior to the senses; the intellect is superior to the mind.', s: 'Bhagavad Gita 3, trans. Arnold' },
    { t: 'Whoever in the midst of pleasure and pain remains undisturbed — that one is fit for immortality.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'As a person casts off worn-out garments and puts on new ones, so the embodied self casts off worn-out bodies.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'The pure in heart are the ones who see.', s: 'the Upanishads' },
    { t: 'Lead me from the unreal to the real; lead me from darkness to light; lead me from death to immortality.', s: 'Brihadaranyaka Upanishad, trans. M\u00fcller' },
    { t: 'That thou art.', s: 'Chandogya Upanishad 6, trans. M\u00fcller' },
    { t: 'From the unreal lead me to the real. The self is not this, not that — and yet it is nearer than the nearest.', s: 'the Upanishads' },
    { t: 'The knower and the known are one.', s: 'the Upanishads' },
    { t: 'There is no wisdom like the wisdom of the self, and no joy like the joy that comes of it.', s: 'the Upanishads' },
    { t: 'Two birds sit on one tree: one eats the fruit, the other watches without eating.', s: 'Mundaka Upanishad, trans. M\u00fcller' },
    { t: 'Truth alone triumphs, not falsehood.', s: 'Mundaka Upanishad, trans. M\u00fcller' },
    { t: 'Even a little of this practice delivers one from great fear.', s: 'Bhagavad Gita 2, trans. Arnold' },
    { t: 'Whatever you do, do it as an offering — and the doing itself becomes the prayer.', s: 'Bhagavad Gita 9, in paraphrase' },
    { t: 'The mind is restless and difficult to restrain, but it is subdued by practice and by indifference to what disturbs it.', s: 'Bhagavad Gita 6, trans. Arnold' },
    { t: 'One who is equal in honour and dishonour, in cold and heat, in pleasure and pain, is fit for liberation.', s: 'Bhagavad Gita 6, trans. Arnold' },
    { t: 'Peace lives in the heart that has stopped needing the world to agree with it.', s: 'Bhagavad Gita 2, in paraphrase' },
    { t: 'Do not use the body to serve the body alone.', s: 'the Vedic tradition' }
  ],

  taoism: [
    { t: 'The Tao that can be spoken of is not the eternal Tao.', s: 'Tao Te Ching 1, trans. Legge' },
    { t: 'The soft overcomes the hard; the gentle overcomes the rigid.', s: 'Tao Te Ching 43, trans. Legge' },
    { t: 'Knowing others is intelligence; knowing yourself is true wisdom.', s: 'Tao Te Ching 33, trans. Legge' },
    { t: 'A journey of a thousand li begins under one\u2019s feet.', s: 'Tao Te Ching 64, trans. Legge' },
    { t: 'The highest good is like water. Water benefits all things and does not compete.', s: 'Tao Te Ching 8, trans. Legge' },
    { t: 'To yield is to be preserved whole.', s: 'Tao Te Ching 22, trans. Legge' },
    { t: 'He who prides himself on his knowledge shows how little he has.', s: 'Tao Te Ching, trans. Legge' },
    { t: 'When I let go of what I am, I become what I might be.', s: 'Tao Te Ching, trans. Legge' },
    { t: 'Do the great while it is still small; begin the difficult while it is still easy.', s: 'Tao Te Ching 63, trans. Legge' },
    { t: 'Nature does not hurry, yet everything is accomplished.', s: 'Tao Te Ching, tradition' },
    { t: 'Empty yourself and let the mind become still.', s: 'Tao Te Ching 16, trans. Legge' },
    { t: 'He who knows that enough is enough will always have enough.', s: 'Tao Te Ching 44, trans. Legge' },
    { t: 'The great perfection seems imperfect, yet it is whole.', s: 'Tao Te Ching 45, trans. Legge' },
    { t: 'Better to stop short than fill to the brim.', s: 'Tao Te Ching 9, trans. Legge' },
    { t: 'The sage does not hoard. The more he does for others, the more he has.', s: 'Tao Te Ching 81, trans. Legge' },
    { t: 'Not-knowing is the beginning of knowing.', s: 'Tao Te Ching 71, in paraphrase' },
    { t: 'When the mind is quiet, the whole world is at peace.', s: 'Tao Te Ching, tradition' },
    { t: 'The valley spirit never dies; it is called the mysterious female.', s: 'Tao Te Ching 6, trans. Legge' },
    { t: 'To know and yet to seem not to know: that is the height.', s: 'Tao Te Ching 71, trans. Legge' },
    { t: 'The wise person does not contend, and therefore no one contends with them.', s: 'Tao Te Ching 81, trans. Legge' },
    { t: 'Without going out of doors, one may know the world.', s: 'Tao Te Ching 47, trans. Legge' },
    { t: 'The stiff and rigid are the companions of death; the soft and yielding are the companions of life.', s: 'Tao Te Ching 76, trans. Legge' },
    { t: 'Let it be still, and it will become clear.', s: 'Tao Te Ching 37, in paraphrase' },
    { t: 'Act without forcing; work without claiming the result.', s: 'Tao Te Ching 2, in paraphrase' }
  ],

  sufism: [
    { t: 'Come, come, whoever you are — wanderer, worshipper, lover of leaving. Ours is no caravan of despair.', s: 'attributed to Rumi' },
    { t: 'The wound is the place where the light enters you.', s: 'attributed to Rumi' },
    { t: 'You are not a drop in the ocean. You are the entire ocean in a drop.', s: 'attributed to Rumi' },
    { t: 'What you seek is seeking you.', s: 'attributed to Rumi' },
    { t: 'Silence is the language of God; all else is poor translation.', s: 'attributed to Rumi' },
    { t: 'Let yourself be silently drawn by the strange pull of what you really love.', s: 'attributed to Rumi' },
    { t: 'Raise your words, not your voice. It is rain that grows flowers, not thunder.', s: 'attributed to Rumi' },
    { t: 'The quieter you become, the more you are able to hear.', s: 'attributed to Rumi' },
    { t: 'Do not be satisfied with the stories that come before you. Unfold your own myth.', s: 'attributed to Rumi' },
    { t: 'As you start to walk on the way, the way appears.', s: 'attributed to Rumi' },
    { t: 'The heart is a mirror; polish it and it will show you what is already there.', s: 'the Sufi tradition' },
    { t: 'The Beloved is nearer to you than the vein in your neck.', s: 'the Qur\u2019an, Qaf 50:16' },
    { t: 'Wherever you turn, there is the face of God.', s: 'the Qur\u2019an, al-Baqara 2:115' },
    { t: 'God is with those who are patient.', s: 'the Qur\u2019an, al-Baqara 2:153' },
    { t: 'He does not burden a soul beyond what it can bear.', s: 'the Qur\u2019an, al-Baqara 2:286' },
    { t: 'To remember is to return.', s: 'the Sufi tradition, on dhikr' },
    { t: 'Poverty of spirit is the death of the self that never stopped asking.', s: 'the Sufi tradition' },
    { t: 'The saint is not one who performs miracles, but one who is at peace in the presence of God.', s: 'the Sufi tradition' },
    { t: 'Die before you die, and you will find that the world is a passing place, not a home.', s: 'the Sufi tradition' },
    { t: 'A heart that praises is a heart already answering.', s: 'the Sufi tradition' },
    { t: 'Not every beauty must be carried away; some is only meant to be sat with.', s: 'The Lotus Cross' },
    { t: 'When the tongue falls silent, the ear becomes a witness.', s: 'the Sufi tradition' },
    { t: 'The path is walked with the feet of patience, not the wings of feeling.', s: 'the Sufi tradition' },
    { t: 'We are all returning guests; carry little.', s: 'the Sufi tradition' }
  ],

  mystics: [
    { t: 'The eye with which I see God is the same eye with which God sees me.', s: 'Meister Eckhart' },
    { t: 'If the only prayer you ever say is thank you, that is enough.', s: 'Meister Eckhart' },
    { t: 'All shall be well, and all shall be well, and all manner of thing shall be well.', s: 'Julian of Norwich' },
    { t: 'It is enough to be in the presence of the Beloved; nothing need happen.', s: 'The Cloud of Unknowing' },
    { t: 'Lift up your heart to God with a little dart of love, and keep it there.', s: 'The Cloud of Unknowing, in paraphrase' },
    { t: 'Every day you may begin again; and that is the whole discipline.', s: 'The Imitation of Christ, on practice' },
    { t: 'A thousand miles of fair weather begins with leaving the house.', s: 'the mystical tradition' },
    { t: 'The afflicted Christ speaks to you: I have given you the whole of what I have.', s: 'Thomas \u00e0 Kempis, The Imitation of Christ' },
    { t: 'Where there is no silence, there is no depth; and where there is no depth, there is nothing to draw from.', s: 'The Lotus Cross' },
    { t: 'To be unknown is to be free. To be known is to be loved. Choose your suffering honestly.', s: 'The Lotus Cross' },
    { t: 'The world is the mirror of a mind that has calmed down enough to look into it.', s: 'The Lotus Cross' },
    { t: 'We speak of the journey, and we have not left the room.', s: 'The Lotus Cross' },
    { t: 'Do not tell me of your visions; tell me how you treat your neighbour on an ordinary Tuesday.', s: 'the mystical tradition' },
    { t: 'The secret of prayer is that it is mostly listening, and not always happily.', s: 'The Lotus Cross' },
    { t: 'Grace does not remove the desert; it lets you keep walking it.', s: 'The Lotus Cross' },
    { t: 'I sought Him and He was everywhere, except where I was looking.', s: 'The Lotus Cross' },
    { t: 'The soul is not a problem to be solved but a space to be kept open.', s: 'The Lotus Cross' },
    { t: 'Everything that is real begins as something you did not necessarily feel like doing.', s: 'The Lotus Cross' },
    { t: 'To be awake is to see the same room as everyone else, and to see it at all.', s: 'The Lotus Cross' },
    { t: 'Take nothing personally and lose nothing sincere.', s: 'The Lotus Cross' },
    { t: 'The quieter your practice becomes, the less it needs an audience.', s: 'The Lotus Cross' },
    { t: 'A tree does not choose where the light comes from; it grows toward it.', s: 'the mystical tradition' },
    { t: 'You cannot stay on a mountain, and you cannot pretend the valley is one.', s: 'The Lotus Cross' },
    { t: 'Faith is the sound of walking when nothing confirms the road.', s: 'The Lotus Cross' }
  ],

  practice: [
    { t: 'Ten minutes of sitting, done today, beats an hour planned for tomorrow.', s: 'The Lotus Cross' },
    { t: 'You will not be rewarded for the practice you imagined, only for the one you did.', s: 'The Lotus Cross' },
    { t: 'If you miss a day, begin again. That is the entire method.', s: 'The Lotus Cross' },
    { t: 'Practise rooting, not floating: say one thing you actually mean today.', s: 'The Lotus Cross' },
    { t: 'The practice is doing the difficult thing gently, not the easy thing twice.', s: 'The Lotus Cross' },
    { t: 'The days you do not want to sit are the days it counts.', s: 'The Lotus Cross' },
    { t: 'Performed kindness is still kindness, but it will tire you; do the quiet kind.', s: 'The Lotus Cross' },
    { t: 'Notice the room you are in, for ten seconds, before you check anything else.', s: 'The Lotus Cross' },
    { t: 'Do the task, not a version of the task that you can photograph well.', s: 'The Lotus Cross' },
    { t: 'The body is where the practice actually happens. Sit in it.', s: 'The Lotus Cross' },
    { t: 'Let one conversation today be entirely about the other person.', s: 'The Lotus Cross' },
    { t: 'Do not measure today against a perfect day that never existed.', s: 'The Lotus Cross' },
    { t: 'Improvement is measured in months, not in mornings.', s: 'The Lotus Cross' },
    { t: 'Whatever you are avoiding has a shape, and the shape is usually a person.', s: 'The Lotus Cross' },
    { t: 'Silence for four minutes. Then decide about the email.', s: 'The Lotus Cross' },
    { t: 'A practice you do badly is a practice. A practice you never do is a belief.', s: 'The Lotus Cross' },
    { t: 'There is no advanced practice. There is only doing it again.', s: 'The Lotus Cross' },
    { t: 'Generosity that costs nothing is a hobby.', s: 'The Lotus Cross' },
    { t: 'The discipline is not the sitting; it is the leaving the phone in another room.', s: 'The Lotus Cross' },
    { t: 'Notice one thing you did today that you would not want anyone else to know.', s: 'The Lotus Cross' },
    { t: 'Talk to one person you usually talk over.', s: 'The Lotus Cross' },
    { t: 'Walk somewhere without a destination for ten minutes.', s: 'The Lotus Cross' },
    { t: 'You are allowed to be slow. You are not allowed to be dishonest.', s: 'The Lotus Cross' },
    { t: 'Ask for what you need before you resent people for not guessing.', s: 'The Lotus Cross' }
  ]
};

const SLOT_MS = 30 * 60 * 1000;

function dayOfYearInLondon(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = t => Number(parts.find(p => p.type === t).value);
  const start = Date.UTC(get('year'), 0, 1);
  const today = Date.UTC(get('year'), get('month') - 1, get('day'));
  return Math.floor((today - start) / 86400000) + 1;
}

function current(date = new Date()) {
  const slot = Math.floor(date.getTime() / SLOT_MS);
  const doy = dayOfYearInLondon(date);
  const themeIndex = ((doy + DAY_OFFSET) % 7 + 7) % 7;
  const theme = ORDER[themeIndex];
  const pool = QUOTES[theme];
  const index = ((slot % pool.length) + pool.length) % pool.length;
  const q = pool[index];
  const nextChange = (slot + 1) * SLOT_MS;
  return {
    theme,
    label: LABELS[theme],
    text: q.t,
    source: q.s,
    index,
    slot,
    pool: pool.length,
    nextChange,
    nextChangeIn: Math.max(0, Math.round((nextChange - date.getTime()) / 1000)),
  };
}

module.exports = { ORDER, LABELS, QUOTES, current, SLOT_MS };
