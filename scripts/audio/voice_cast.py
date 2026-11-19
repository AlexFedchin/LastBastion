"""Last Bastion: the radio cast and a direction for every line.

PERSONA describes each character's voice (Qwen3-TTS VoiceDesign builds the voice
from it). DIRECTION says how each line is performed, as an actor would be told,
plus how intense it is (0 = flat and quiet, 1 = screaming): the intensity also
sets the target the take scorer looks for (voice_score.py) and Chatterbox's
emotion exaggeration.

Lines are keyed by their exact text in src/config.js; a line missing here falls
back to the character's default direction.
"""

PERSONA = {
    'SGT. KOVAC': "Male, mid-forties, a veteran infantry sergeant: deep, rough, gravelly baritone worn hoarse by smoke and "
                  "shouting, a faint Eastern European edge, plain-spoken and hard, a man holding his squad together.",
    'PVT. ARAN': "Male, about twenty, a young private: soft, light tenor, gentle and unsure, a frightened kid trying to sound steady.",
    'COMMAND': "Male, late fifties, a senior British army staff officer on a long-range radio: measured, clipped received "
               "pronunciation, low and composed, deeply tired.",
    'UNKNOWN': "Female, early thirties, an exhausted civilian mother on a radio: thin, breathy, trembling American voice.",
    'SURVIVOR': "Female, early thirties, an exhausted civilian mother on a radio: thin, breathy, trembling American voice.",
    'AUTOMATED': "Female, a pre-recorded automated British announcement: neutral, perfectly even, impersonal and slightly synthetic.",
    'BATTERY': "Male, late twenties, an American artillery fire-direction radio operator: brisk, clipped, matter-of-fact procedural voice.",
    'SPECTRE 2-1': "Male, late thirties, an American gunship pilot: relaxed, cool, confident mid-range voice with a slight "
                   "Southern drawl, unhurried, the calmest man in the sky.",
    'SPECTRE 2-2': "Male, mid-forties, an American gunship aircraft commander: low, steady, serious bass-baritone, Midwestern, "
                   "controlled anger under the professionalism.",
    'HAMMER 1-1': "Male, early thirties, an American fighter-bomber pilot: crisp, fast, confident and businesslike tenor-baritone, "
                  "a little breathy through an oxygen mask.",
    'LT. HOLLIS': "Male, early thirties, an American recon lieutenant: firm, athletic voice, out of breath from running.",
    'REACH 3-1': "Male, forties, a British transport aircraft pilot: steady, warm, calm professional voice, northern English accent.",
    # the ending: strangers answering Kovac's broadcast on the morning after the last night
    'THE RIDGE': "Female, mid-forties, a hardened survivor on a weak handheld radio: low, hoarse, steady alto, "
                 "tired to the bone, Scottish accent, careful and wary.",
    'THE QUARRY': "Male, about sixty, a farmer leading a group of refugees, on an old CB radio: slow, warm, rough bass voice, "
                  "Irish accent, cautious hope.",
    # the extraction flight on the last night: the lifters' lead and the gunship escort
    'NIGHTINGALE': "Female, late thirties, a British helicopter flight lead on the radio: clear, low, controlled alto, "
                   "precise and warm, unflappable, the calm voice that has done this many times.",
    'REAPER 1-1': "Male, about thirty, an American attack helicopter pilot: fast, dry, confident tenor with a Texan edge, "
                  "speaking over rotor noise, steady under fire.",
    # the hangar's quartermaster, signing out the requisitions at dawn (src/world/hangar.js)
    'CPL. VOSS': "Male, early fifties, a quartermaster corporal: dry, unhurried, slightly nasal mid-range voice, Dutch accent, "
                 "a practical man who has counted every crate twice, deadpan humour.",
    # the chronicle at every dawn: not on the radio, told years later
    'NARRATOR': "Male, about seventy, an old soldier telling the story of the siege decades later: a deep, warm, weathered "
                "baritone with soft gravel, slow and measured, intimate and haunted, a storyteller by a fire; clear, unhurried diction.",
}

# What the voice reference is designed on: a neutral line in the character's normal register.
REF_TEXT = {
    'SGT. KOVAC': "Listen to me. We hold this wall until somebody tells us otherwise. Keep the belt fed, keep your head down, and do not stop shooting.",
    'PVT. ARAN': "I wrote my mother a letter last week. I don't know if it ever left the base. I keep thinking about her kitchen.",
    'COMMAND': "This is Command. Situation unchanged. Maintain your position and report at the top of every hour. Command out.",
    'UNKNOWN': "Hello? Is anyone there? Please, we need help. We've been walking for two days and we don't have any water left.",
    'SURVIVOR': "Hello? Is anyone there? Please, we need help. We've been walking for two days and we don't have any water left.",
    'AUTOMATED': "This is an automated message. All units are to remain on this frequency. Further instructions will follow.",
    'BATTERY': "Fire mission received. Adjusting, stand by. Rounds complete, battery is ready for the next mission.",
    'SPECTRE 2-1': "Roger that, we're orbiting at eight thousand feet. Plenty of fuel and plenty of rounds. Just tell us where you want it.",
    'SPECTRE 2-2': "Copy all. We're coming up on the orbit now. Weapons are hot and we have the whole valley on the scope.",
    'HAMMER 1-1': "Hammer flight, check in. Fuel is good, systems are good. Proceeding to the holding point, angels twelve.",
    'LT. HOLLIS': "Okay, listen up. We move fast and we move quiet. Stay on my six and nobody stops for anything.",
    'REACH 3-1': "Good evening, this is Reach. We're established on the approach, cargo is rigged, and the crew is ready back there.",
    'THE RIDGE': "We're about twelve of us. We've been in the hills since the city went. We've got water for a day, maybe two.",
    'THE QUARRY': "This is the quarry. We've a tractor, a trailer and forty souls. The road down's clear as far as the old mill.",
    'NIGHTINGALE': "Nightingale flight, check in. Three lifters, escort is with us. We are low level, following the river north.",
    'REAPER 1-1': "Reaper one-one, guns are hot, fuel is good. We'll keep the lifters covered all the way in.",
    'CPL. VOSS': "Two crates of belted fifty, one case of grenades, pins in. Sign here, and here. Bring the empty cans back.",
    'NARRATOR': "It was a long time ago now. But some nights, when the wind comes down the valley, I can still hear the gun.",
}

# characters sharing a voice: the survivor is the woman from the overpass, close now
SAME_VOICE = {'SURVIVOR': 'UNKNOWN'}

LANG_HINT = {}

DEFAULT = {
    'SGT. KOVAC': ("Firm, hard and steady, a sergeant giving it to his men straight.", 0.45),
    'PVT. ARAN': ("Quiet and shaky, a scared young soldier.", 0.3),
    'COMMAND': ("Calm, formal and controlled radio procedure.", 0.3),
    'UNKNOWN': ("Desperate and frightened, breaking up.", 0.6),
    'SURVIVOR': ("Desperate and frightened, shouting into the radio while running.", 0.8),
    'AUTOMATED': ("Flat, mechanical, perfectly even pre-recorded announcement.", 0.15),
    'BATTERY': ("Brisk routine radio procedure, quick and clipped.", 0.4),
    'SPECTRE 2-1': ("Calm, cool and unhurried routine radio call.", 0.35),
    'SPECTRE 2-2': ("Steady, serious, professional radio call.", 0.35),
    'HAMMER 1-1': ("Crisp, fast, confident pilot radio call.", 0.45),
    'LT. HOLLIS': ("Urgent and out of breath, running.", 0.7),
    'THE RIDGE': ("Wary and quiet, worn out, holding back hope.", 0.35),
    'THE QUARRY': ("Slow and cautious, an old man daring to hope.", 0.35),
    'REACH 3-1': ("Calm, warm, professional pilot radio call.", 0.3),
    'NIGHTINGALE': ("Clear, calm and controlled helicopter radio call.", 0.4),
    'REAPER 1-1': ("Fast, confident attack pilot radio call over rotor noise.", 0.55),
    'CPL. VOSS': ("Dry and matter-of-fact over a handheld radio, a tired craftsman pleased with the work.", 0.3),
    'NARRATOR': ("Slow, low and measured, an old man remembering; quiet gravity, unhurried pauses between the sentences.", 0.22),
}

# text -> (direction, intensity)
DIRECTION = {
    # ── night-by-night story ───────────────────────────────────────────────
    'Bastion-7, this is Command. Extraction is set for the seventy-second hour. Hold until then.':
        ("Calm, confident and businesslike, a routine order, the officer still believes the flight will come.", 0.3),
    'You heard the man. Seventy-two hours. Keep that barrel cool and the wall clean.':
        ("Gruff and dry, half a smirk, rallying his men with easy authority. Steady pace.", 0.4),
    'Bastion-7, Command. The bridge at Halden is down. Nobody leaves that valley by road now. Keep the gate shut.':
        ("Grim, flat and controlled, delivering bad news without emotion, short heavy pauses between sentences.", 0.28),
    'Whatever you hear out there tonight — the gate stays shut.':
        ("Low, hard and deliberate, a warning; slow, every word weighted, quiet menace.", 0.35),
    "...anyone on this frequency... we're at the overpass, we have children with us, please—":
        ("Desperate, whispering and close to sobbing, terrified of being overheard, voice cracking and breaking on 'please'.", 0.6),
    "Overpass is forty klicks out. There's nothing we can do. Eyes front.":
        ("Cold and clipped on the surface, swallowing guilt; a heavy pause, then a hard, final 'Eyes front.'", 0.3),
    'Bastion-7, airdrop of fuel and ammunition inbound at dawn. Mark your drop zone.':
        ("Composed, businesslike, a little brighter, a rare piece of good news.", 0.3),
    "Bloaters in the mix tonight. Don't let them touch the wall.":
        ("Serious, low warning, matter-of-fact with an edge of disgust.", 0.4),
    '...all stations, Bastion-3 has fallen. Bastion-5 is not responding.':
        ("Hollow, shaken and slow, the officer's composure slipping; long weary pauses.", 0.25),
    "We're what's left on this line. Make it count.":
        ("Quiet, grave and resolute, steel under exhaustion, a short speech to his men.", 0.35),
    'Bastion-7... airframes are short... (static) ...the flight goes only for fifteen souls or more. Keep your people alive.':
        ("Halting and ashamed, an officer reading out a cold rule he hates; tired, breaking up, quieter on the last sentence.", 0.28),
    'Fifteen. You heard him. Nobody else dies on this wall.':
        ("Hard and low, a vow; slow, each sentence heavier, iron on the last.", 0.45),
    "Command hasn't answered since 0300. I'm sure it's the antenna.":
        ("Dry, weary, forced casualness, a joke nobody believes, a hollow little laugh in the voice.", 0.25),
    'Sarge... the city stopped burning.':
        ("Barely above a whisper, numb and awed, a young man staring at the horizon.", 0.2),
    'This frequency is no longer monitored. This frequency is no longer monitored.':
        ("Completely flat, mechanical, perfectly even, both sentences in exactly the same way.", 0.1),
    'Then we monitor it. Bastion-7 is holding. Say it.':
        ("Defiant and fierce, low and intense, demanding; 'Say it' is an order.", 0.55),
    'Biggest one yet coming down the valley. Everything we have, tonight.':
        ("Tense and grim, controlled urgency, steeling himself for the worst night.", 0.5),
    'Sarge, if this is it... it was an honour.':
        ("Soft, tearful and sincere, a young soldier saying goodbye, voice catching.", 0.25),
    'Seventy-two hours, and not enough of us left to be worth a flight. Whatever comes down that valley — we are still here.':
        ("Bitter and bone-tired at first, then slow, proud and defiant, a fierce quiet strength on 'we are still here'.", 0.45),
    'Seventy-two hours. This is the last night. Whatever comes down that valley — we are still here.':
        ("Slow, proud and defiant, a final rallying speech, building to a fierce, quiet strength on 'we are still here'.", 0.5),
    'If anyone is listening: Bastion-7 is holding. Bastion-7 is holding.':
        ("Exhausted but unbroken, broadcasting into the dark; the second time quieter and more personal.", 0.35),
    'No birds. No orders. Just the night, and the gun.':
        ("Low, weary, almost meditative, a man who has accepted his fate.", 0.25),
    'Count the survivors. Then count the dead out there. Keep counting.':
        ("Grim, bone-tired and bitter, flat and slow.", 0.3),
    'I stopped writing their names down.':
        ("Quiet, hollow and numb, a confession, almost a whisper.", 0.15),
    "They'll come again tomorrow. So will we.":
        ("Tired, stoic, a grim half-smile, quiet resolve.", 0.3),
    # ── Kovac answering the radio (REACTIONS in config.js: straight after the line he hears) ──
    'Bastion-7, Command. Be advised... your extraction is delayed. No new time. Command out.':
        ("Tired and uncomfortable, reading out bad news he has no answer for; flat, a little hurried, signing off before anyone can argue.", 0.25),
    "Down. The one road out of here, and it's down. Damn it.":
        ("Bitter and angry under his breath, a man taking a blow; the first word flat with disbelief, 'Damn it' muttered through his teeth.", 0.45),
    "An airdrop! You hear that? Somebody back there still remembers we're here.":
        ("Genuinely glad and surprised, a rough laugh breaking through the fatigue; warm, lifted, almost cheerful for once.", 0.6),
    "Fifteen souls. They've got a quota now. Keep your people alive, he says. What does he think we've been doing?":
        ("Irritated and sarcastic, contempt for the desk officers; biting on 'quota', mocking on 'he says', angry on the question.", 0.6),
    "Delayed? Delayed! Six nights on this wall, and they're delayed. Fine. Fine! We hold.":
        ("Furious, exasperated disbelief: a flat question, then an angry outburst on the second 'Delayed!', seething; then he reins it in, curt and hard on 'We hold.'", 0.8),
    "Don't look at it, kid. Look at the field.":
        ("Gentle but firm, a father's gruffness, quiet and close; protecting a frightened boy.", 0.25),
    "Save it, Aran. Tell me at dawn.":
        ("Gruff and warm at once, refusing to hear a goodbye; a small catch in the voice, then steady.", 0.3),
    "That's our ride! They came. They actually came! Hold that wall!":
        ("Overjoyed, relieved almost to tears, a laugh in the voice, shouting with real happiness; then a fierce order.", 0.9),
    "Forty seconds! You hear me? Forty seconds, hold on!":
        ("Shouting over the din, desperate hope and urgency, rallying exhausted men.", 0.9),
    "Artillery. Now we're talking.":
        ("Pleased, a satisfied grin you can hear, dry and approving.", 0.45),
    "A bomber. About time they sent us something with teeth.":
        ("Dry, a little sardonic but pleased, a grim smile.", 0.4),
    "Ha! Look at that! Hell of a shot, Hammer!":
        ("Delighted, a barking laugh, cheering a direct hit over the noise.", 0.85),
    "A gunship over our heads. Thank God.":
        ("Deep relief, quiet and heartfelt, an exhale of gratitude.", 0.3),
    "Heh. Funny man. Keep it coming, Spectre.":
        ("Amused despite himself, a short dry chuckle, easy camaraderie.", 0.4),
    "Tell your navigator the drinks are on us.":
        ("Wry and warm, a tired smile, soldierly humour.", 0.35),
    "Nobody's walking, Spectre. Not on my watch.":
        ("Serious, a quiet promise between soldiers, steady and sincere.", 0.4),
    "Copy, two-two. They were good men. Let's make it count.":
        ("Sombre and grieving, low and slow, then hardening into resolve.", 0.35),
    "Fog. Now. Perfect. Just perfect.":
        ("Irritated and sarcastic, a heavy sigh; deadpan exasperation, each word dropped flat.", 0.45),
    "There's our resupply. Right on time, for once.":
        ("Pleased and relieved, a little wry on 'for once'.", 0.45),
    "Glad to have you, Lieutenant. Grab a rifle.":
        ("Warm, relieved and matter-of-fact, welcoming a fellow soldier.", 0.4),
    "I'll hold you to that, Hollis. Get those people inside.":
        ("Happy, a tired laugh, warmth and relief; then businesslike.", 0.5),
    # ── Kovac's barks over the gun ───────────────────────────────────────
    'Big group coming down the valley!':
        ("Shouting a warning over machine-gun fire, urgent and loud.", 0.85),
    'Horde inbound! Get on them!':
        ("Bellowing an order over gunfire, aggressive and urgent.", 0.9),
    'Here they come — dozens! Hundreds!':
        ("Shouting, rising alarm, the count climbing into fear on 'Hundreds!'", 0.9),
    "Movement on the ridge — it's a whole wave!":
        ("Shouting a sharp alarm, startled and urgent.", 0.85),
    "They're stacking on the wall!":
        ("Yelling, alarmed and urgent, over gunfire.", 0.9),
    "They're climbing! Clear that section!":
        ("Yelling a frantic order over gunfire.", 0.9),
    "Wall's going — shoot the pile!":
        ("Screaming in alarm, desperate, over gunfire.", 0.95),
    "They're over the wall!":
        ("Screaming in panic, voice cracking, over gunfire.", 1.0),
    'Breach! We lost someone!':
        ("Screaming in panic and grief, voice cracking.", 1.0),
    'Man down! They got in!':
        ("Screaming, horrified, panicked, over gunfire.", 1.0),
    "Barrel's cooked!":
        ("Shouting a frustrated warning, angry.", 0.75),
    "Gun's too hot!":
        ("Shouting a sharp, frustrated warning.", 0.75),
    "Sun's up. We made it.":
        ("Exhausted relief, a long breath out, quiet and hoarse.", 0.2),
    'Dawn. Count the living.':
        ("Bone-tired, grim and quiet.", 0.2),
    'Another night. Another dawn.':
        ("Weary and hollow, a sigh, quiet.", 0.15),
    'Look at them burn!':
        ("Fierce, savage exhilaration, shouting over the fire.", 0.85),
    "That's a whole column gone!":
        ("Shouting with fierce triumph, adrenaline.", 0.85),
    'Keep it up!':
        ("Shouting encouragement, fierce and energetic.", 0.8),
    # ── fire support ──────────────────────────────────────────────────────
    'Shot, over. Four rounds HE, splash in three.': ("Brisk, clipped routine radio procedure.", 0.35),
    'Shot, over. Six rounds HE, splash in three.': ("Brisk, clipped routine radio procedure.", 0.35),
    'Shot, over. Eight rounds HE, splash in three.': ("Brisk, clipped routine radio procedure, slightly faster.", 0.4),
    'Shot, over. Ten rounds HE, splash in three.': ("Brisk, clipped radio procedure, a little urgency.", 0.45),
    'Red smoke out! Get your heads down!':
        ("Shouting a warning to everyone on the wall, urgent and loud.", 0.9),
    'Danger close! Everything on the wall line — God forgive us.':
        ("Shouting the order with anguish, then the last words drop to a broken, guilt-stricken murmur.", 0.8),
    'Hammer one-one, I have your red smoke. One GBU, danger close. Heads down, Bastion.':
        ("Crisp, fast and focused pilot radio call, serious on 'danger close'.", 0.5),
    'Hammer one-one, tally your mark. Two-thousand pounder inbound, ten seconds.':
        ("Crisp, fast and confident pilot radio call.", 0.5),
    'Copy red flare. Hammer one-one is in hot — keep your heads down.':
        ("Crisp and focused, picking up intensity on 'in hot'.", 0.55),
    "Good effect on target. That's a lot of them down. Hammer one-one off and climbing.":
        ("Pleased and confident, a little adrenaline, a touch of satisfaction.", 0.45),
    'Shack. Direct hit on your mark. Hammer one-one off target.':
        ("Satisfied, cocky, quick, a grin in the voice on 'Shack'.", 0.5),
    'Bomb impact. Hammer one-one off target, re-arming.':
        ("Calm, routine, quick pilot radio call.", 0.35),
    # Spectre two-one's check-in, a different dark joke every night (COMMS.spectreIntro)
    "Bastion-7, Spectre two-one on station overhead. Lovely valley you've got down there. Shame about the neighbours. We'll work the field — you hold that wall.":
        ("Calm and cool, a dry deadpan joke told with a smile in the voice, then easy and confident on the last sentence.", 0.35),
    "Spectre two-one, back on station. Same crowd as last night, Bastion. They don't learn, and they never tip.":
        ("Relaxed, wry and deadpan, like a tired cab driver's joke, a small chuckle at the end.", 0.35),
    "Spectre two-one on station. Good news, Bastion: we checked, and there's no rule against shooting people who are already dead. We'll take the field.":
        ("Dry gallows humour, mock-official on 'we checked', amused, then cool and businesslike at the end.", 0.4),
    "Spectre two-one overhead. Our navigator says we've killed more of them than live in his home town. He's from a big town. Rounds away.":
        ("Deadpan dark joke, a beat of timing before 'He's from a big town', then cool and routine on 'Rounds away'.", 0.35),
    "Evening, Bastion. Spectre two-one on station. Bad news, we're the cavalry. Good news, the cavalry brought a one-oh-five.":
        ("Warm and wry, self-mocking on 'we're the cavalry', a grin in the voice on the punchline.", 0.4),
    "Spectre two-one, overhead again. Fuel's low, coffee's cold, valley's full. If we ever go down out there, Bastion, don't let them make us walk.":
        ("Tired and wry at first, a dark joke, then quieter and half serious on the last sentence, still with a faint smile.", 0.35),
    'Rifle, one-oh-five. Big group — splash in five.':
        ("Focused, crisp and calm radio call.", 0.4),
    'Good hits, good hits. Lot of movement down there, Bastion.':
        ("Cool and pleased, unhurried, mildly impressed.", 0.4),
    'Shifting fire. Keep that fifty talking.':
        ("Calm and easy, a friendly instruction.", 0.35),
    'Spectre still on station. We have you covered.':
        ("Warm, calm and reassuring.", 0.3),
    'Big group moving up the road — engaging.':
        ("Focused and alert, calm but quicker.", 0.45),
    'Sparkle on the treeline. Rounds away.':
        ("Cool, routine, quiet concentration.", 0.35),
    # Spectre two-two, after two-one went down: their jokes are what he misses (COMMS.spectreIntro2)
    "Bastion-7, Spectre two-two on station. Two-one were friends of ours. Their pilot had a bad joke for every night over this valley. We'd give anything to hear one now. Let's make them pay for it.":
        ("Steady and professional, then low and grieving on 'friends of ours', a sad fond warmth about the jokes, and cold, hard anger on the last sentence.", 0.45),
    "Spectre two-two, on station for the last night. Two-one would have had a joke ready for this one. None of us can think of it. Let's finish it for them.":
        ("Low, quiet and heavy, a sad half-smile about the joke, then steady resolve on the last sentence.", 0.4),
    "Spectre two-two, back over the valley. Somebody has to tell two-one's jokes now. Here's one: the dead outnumber us a thousand to one. That's it, that's the joke. Rounds away.":
        ("Bone-dry gallows humour from a serious man trying it out, flat delivery of the punchline, then cool and routine.", 0.35),
    "Spectre two-two on station. Two-one used to say this valley was the only show where the crowd never leaves early. Still true, Bastion.":
        ("Quiet and fond, remembering a friend's joke, a small sad smile, then dry and steady.", 0.35),
    "Spectre two-two overhead. Two-one kept a tally on the cockpit wall. We kept painting over it. Tonight we start our own.":
        ("Low and steady, a wistful memory, then grim determination on the last sentence.", 0.4),
    'We see it, Bastion. Putting everything we have on the big one.':
        ("Serious, focused and determined, the calm cracking a little.", 0.5),
    'Spectre is blind in this soup. Holding fire until it clears.':
        ("Frustrated, dry and calm.", 0.35),
    "We have you on thermals, Bastion. We'll be your eyes.":
        ("Warm, reassuring and steady.", 0.3),
    "Mayday, mayday! Spectre two-one, fire in number three — we've lost hydraulics — we're going down!":
        ("Screaming a mayday call in terror, frantic and breathless, all the calm gone, alarms in the cockpit.", 1.0),
    # ── unlock briefings ──────────────────────────────────────────────────
    "Engineers found a crate of bottles and a jerrycan in the depot. Put a Molotov on the wall base and let them burn. And there's a crate of grenades at your feet, for anything climbing.":
        ("Practical, gruff briefing, with grim satisfaction, conversational.", 0.35),
    'Bastion-7, Command. You now have a one-oh-five battery on call. Call a fire mission wherever you need it.':
        ("Composed, formal and businesslike briefing.", 0.3),
    'Flares came up with the shells. F puts one over the field — anything in the light goes down easier.':
        ("Practical gruff briefing, a little approving.", 0.35),
    "Bastion-7, Hammer one-one is on call tonight. Throw a red flare where you want it, and keep your heads down.":
        ("Confident, crisp and friendly pilot radio call.", 0.4),
    'Listen. If it all goes wrong, we can bring the guns down on our own wall line. It will cost us men. Use it only if the wall is lost.':
        ("Low, slow and deadly serious, heavy with dread, every sentence a weight.", 0.3),
    # ── night events ──────────────────────────────────────────────────────
    "Bastion-7, this is Hollis, Recon Two. Four of us coming in hot down the road — they're right behind us. Cover us!":
        ("Panting and running, urgent and loud, desperate on 'Cover us!'", 0.9),
    "Friendlies on the road! Kill what's chasing them — and watch your fire!":
        ("Shouting urgent orders, sharp and commanding.", 0.85),
    'Man down! Keep moving, keep moving!':
        ("Screaming while running, anguished and desperate, out of breath.", 1.0),
    "We're through the gate. Thanks for the cover, Bastion. Recon Two will take a spot on the wall.":
        ("Out of breath, relieved and grateful, calming down.", 0.45),
    'Some of Recon Two made it in. Not all of them.':
        ("Quiet and heavy, sombre.", 0.25),
    'Recon Two is gone. Eyes front.':
        ("Flat and cold, burying the grief, hard on 'Eyes front'.", 0.3),
    "Bastion, we can see your lights! We're coming down the road — please, don't shoot!":
        ("Shouting into the radio while running, frantic, hopeful and terrified, pleading on 'please, don't shoot!'", 0.9),
    'Civilians on the road. Hold your fire on them and cover them all the way to the gate!':
        ("Commanding and urgent, sharp orders.", 0.75),
    'No! No, not him — keep running!':
        ("Screaming in horror and grief, sobbing, out of breath.", 1.0),
    'Got them. Every last one. Somebody find them some blankets.':
        ("Warm, relieved and tired, a rare softness.", 0.3),
    'We got some of them in. Some.':
        ("Tired, sad and quiet, the second 'Some' heavy.", 0.25),
    'None of them made it. Eyes front.':
        ("Quiet and flat, swallowing grief, hard on 'Eyes front'.", 0.3),
    'Bastion-7, Reach three-one, thirty seconds out with your resupply. Look for the strobe.':
        ("Calm, steady and friendly pilot radio call, engines loud.", 0.35),
    'Load away, load away. Good chute. Reach three-one is clear — good luck down there.':
        ("Calm and satisfied, then sincere and warm on 'good luck down there'.", 0.35),
    'Gate squad, out! Cover them in!':
        ("Barking an order down to the gate, loud and urgent over the gunfire.", 0.85),
    'Open the gate — squad out, bring them home!':
        ("Shouting the order, urgent and determined, rising on 'bring them home'.", 0.85),
    'Second squad, out the gate! Covering fire!':
        ("Loud, sharp command shouted over gunfire.", 0.85),
    'Everybody in? Squad, back inside — shut the gate!':
        ("Quick check, then a hard shouted order, relieved but still urgent.", 0.7),
    "That's all of them. Gate squad, pull back!":
        ("Relieved, then a firm shouted order to pull back.", 0.65),
    'Man down at the gate! Pull back, pull back!':
        ("Alarmed, shouting desperately, the repeat more frantic.", 0.95),
    "Crate's down in the field! Keep them off it until the recovery team gets out there!":
        ("Shouting urgent orders over the gunfire.", 0.85),
    "They're all over the crate — clear them off!":
        ("Yelling, alarmed and urgent.", 0.9),
    "Recovery team has the crate! Flares, grenades, and the battery's reloaded.":
        ("Shouting with relief and satisfaction, excited.", 0.7),
    "They've torn the crate apart. Damn it.":
        ("Angry and bitter, a frustrated curse under his breath.", 0.5),
    'Something big coming down the road... my God, look at the size of it.':
        ("Quiet, slow, shaken dread; trailing off in disbelief, almost a whisper by the end.", 0.35),
    "It's at the wall! It's tearing the wall apart — kill it!":
        ("Screaming in raw panic over deafening gunfire, voice cracking, breathless.", 1.0),
    "It's down! The big one is down!":
        ("Shouting in triumph and relief, exhilarated.", 0.85),
    "That's not like the other one. That's bigger. Everything we have — put it on that thing!":
        ("Starting low and shaken with dread, then building to a fierce shouted order.", 0.8),
    "It's down. Whatever that was, it's down.":
        ("Breathless, stunned relief, quiet.", 0.35),
    'Brutes! A whole herd of them — left flank!':
        ("Shouting an urgent warning over gunfire.", 0.9),
    'Brutes! A whole herd of them — right flank!':
        ("Shouting an urgent warning over gunfire.", 0.9),
    'Bloaters! A whole column of them on the road — pop them before they reach the wall!':
        ("Shouting an urgent warning and order over gunfire.", 0.85),
    'Bastion-7, Command. Fog bank moving up the valley. Expect visibility near zero.':
        ("Calm, formal, a measured weather warning.", 0.3),
    "Fog's lifting. Back to work.":
        ("Dry, gruff and relieved.", 0.35),
    "Generator's gone! We've lost the lights — pop flares!":
        ("Shouting in alarm, urgent and sharp.", 0.9),
    "Power's back. Thank God.":
        ("Exhaling with relief, quiet.", 0.25),
    "Spectre's down... God rest them. We're on our own up here.":
        ("Stunned and grieving, quiet and slow, then grim and resigned.", 0.25),
    # ── the chronicle at dawn (NARRATOR) ──────────────────────────────────
    'On the first night, the dead came down the valley in their thousands. Bastion-7 answered them with one gun.':
        ("Slow and grave, the opening of a long story; a pause, then quiet pride on 'one gun'.", 0.25),
    'On the second night, word came that the bridge at Halden was down. There was no road out of the valley any more. Only the sky, we told ourselves.':
        ("Measured and weary, a wry, sad smile on 'Only late, we told ourselves'.", 0.2),
    "The third night began with a woman's voice on the radio, begging for help that we could not give.":
        ("Low and heavy with old guilt, slowing down at the end.", 0.2),
    'On the fourth night, Command promised us an airdrop. The bloaters came down the valley to meet it.':
        ("Dry and grim, measured storytelling with a bitter edge.", 0.22),
    'On the fifth night, Bastion-3 fell, and Bastion-5 went silent. We were the last lights left on the line.':
        ("Hushed and solemn, a long pause before the last sentence, quiet and lonely.", 0.2),
    'On the sixth night, Command told us the birds would only fly for fifteen souls or more. After that, we counted heads every hour.':
        ("Dry, weary and sardonic, an old man shaking his head.", 0.2),
    "By the seventh night, Command had stopped answering. Out on the horizon, the city's fires were going out.":
        ("Quiet, numb and slow, haunted, almost a whisper at the end.", 0.15),
    'On the eighth night, a recorded voice told us that no one was listening anymore. We kept talking anyway.':
        ("Low and weary, then a stubborn, defiant warmth on 'We kept talking anyway'.", 0.25),
    'On the ninth night, the biggest horde we had ever seen filled the valley from the wall to the ridge. We gave it everything.':
        ("Building tension, growing intensity, then firm and proud on 'We gave it everything'.", 0.4),
    'The tenth night. The seventy-second hour. The last night — if the promises had ever meant anything at all.':
        ("Very slow and solemn, each phrase weighted, then bitter and quiet at the end.", 0.25),
    'Another night came, as they always did, and the dead came with it.':
        ("Weary and fatalistic, slow.", 0.18),
    'There were no more orders and no more promises. Only the wall, the night, and the gun.':
        ("Low, meditative and grim, a slow cadence on the last three things.", 0.2),
    'We had stopped counting the nights. The dead had not stopped coming.':
        ("Hollow and tired, slow, the second sentence colder.", 0.18),
    'Recon Two came down the road with half the valley at their heels. Every one of them made it through the gate.':
        ("Rising with remembered excitement, then warm relief and pride on the last sentence.", 0.45),
    'Recon Two ran the last mile under our guns. Not all of them reached the gate, and the ones who did never spoke of the others.':
        ("Tense at first, then quiet and sombre.", 0.3),
    'Recon Two died on the road, a few hundred metres from the gate. We watched every moment of it through the sights.':
        ("Flat and heavy with grief, slow, a haunted pause before the last sentence.", 0.2),
    'The woman from the overpass found our lights. She brought every one of those children through the gate alive. For one night, the wall meant something.':
        ("Tender and moved, voice softening with emotion, warm and proud on the last sentence.", 0.3),
    'The people from the overpass ran for our lights. Some of them made it inside. The mother would never say the names of the others.':
        ("Gentle and sad, slow, quieter at the end.", 0.2),
    'The people from the overpass ran for our lights. None of them reached the gate. Their voices stopped, one by one, out on the open road.':
        ("Grief-stricken and quiet, very slow at the end, almost breaking.", 0.2),
    'The crate came down under a grey canopy, and we held the field around it until the recovery team dragged it home. Ammunition, bottles, and a little hope.':
        ("Vivid and lively storytelling, a warm smile on 'a little hope'.", 0.35),
    'The crate came down in the field, and the dead tore it open like a carcass. We watched our supplies scatter in the mud.':
        ("Bitter and grim, disgust on 'like a carcass'.", 0.3),
    'Then the first giant came down the road, as tall as the wall itself. It fell in the open field, and the whole valley shook when it hit the ground.':
        ("Awed and ominous, building, then a powerful, dramatic release at the end.", 0.45),
    'Then the first giant came. It reached the wall and tore at the concrete with its bare hands, and the bastion shook, until at last we brought it down.':
        ("Dread building to intensity in the middle, then a hard-won, exhausted triumph at the end.", 0.5),
    'And then it came — the biggest of them all. We threw everything we had left at it, and somehow, out there in the field, it fell.':
        ("Ominous and hushed at first, growing in intensity, then awed disbelief at the end.", 0.45),
    "And then it came — the biggest of them all. It reached our wall, and for a long moment I thought the whole line would come down with it. It didn't. It fell.":
        ("Hushed dread building to a peak, a long pause, then a quiet, shaken 'It didn't. It fell.'", 0.5),
    'A herd of brutes came down the flank in a stampede, and the wall shuddered under their weight. It held. Barely.':
        ("Vivid and intense, then clipped and dry on 'It held. Barely.'", 0.45),
    'A column of bloaters walked down the road like a funeral procession. We burst them in the field, one after another, and the valley stank of it for days.':
        ("Dark, grim humour, slow and deliberate.", 0.3),
    'Then the fog rolled up the valley, thick as wet wool, and the dead walked out of it close enough to touch. We fired at shadows.':
        ("Eerie and hushed, creeping dread, slow.", 0.3),
    'Then the generator died, and the lights went out all along the wall. We fought on in the dark, by flare-light and muzzle flash.':
        ("Tense and vivid, quickening a little, then grim determination.", 0.4),
    'Spectre went down that night. We watched it fall burning into the hills, and after that there was no one above us but God.':
        ("Grieving and slow, heavy, the last words almost a prayer.", 0.22),
    'When the wall was lost, we called the guns down on our own heads. Three of ours died in that fire. The wall held.':
        ("Heavy with guilt that never faded, slow, the last sentence hard and quiet.", 0.3),
    "The wall base burned all night. The dead walked into the flames screaming, and kept on walking, until they didn't.":
        ("Dark and haunted, vivid, the last words cold and final.", 0.35),
    'Somewhere past midnight the gun found its rhythm, and the dead went down in rows, like wheat before the scythe.':
        ("Grim and rhythmic, a terrible poetry, low and steady.", 0.35),
    'Not one name was added to the list that night. On that wall, it was as close to a miracle as we ever came.':
        ("Warm, quiet wonder, a soft smile.", 0.25),
    'We lost good men on the walkway that night. We buried them at first light, beside the others.':
        ("Quiet, sorrowful and dignified.", 0.18),
    'The wall took a terrible toll that night. By morning there were empty places all along the walkway, and nobody spoke of them.':
        ("Heavy grief, slow and hushed.", 0.18),
    'By dawn there were so few of us left that we stood further apart, so that from the valley, the wall would still look manned.':
        ("Hushed and broken, near tears but holding steady, very slow.", 0.2),
    'When the sun came up, the valley was grey with bodies. Seventy-two hours, Command had said. Sixty-four to go.':
        ("Weary and grim, a dry, tired cadence on 'Sixty-four to go'.", 0.22),
    'At dawn the gate was still shut. Whatever we had heard out there in the dark, we never opened it.':
        ("Quiet and haunted, slow.", 0.18),
    'By morning the radio was quiet. Kovac sat beside it for a long time, listening to the static.':
        ("Tender and sad, slow, fading out at the end.", 0.15),
    'The fourth dawn came up cold and red. The crows had learned where to find us.':
        ("Bleak and poetic, slow.", 0.18),
    'That morning we understood that there was no line anymore. There was only us.':
        ("Quiet realisation, solemn, a long pause before 'There was only us'.", 0.2),
    'At dawn, Kovac counted heads twice, and chalked the number on the wall where everyone could see it.':
        ("Dry, quiet and wry, an old soldier's understatement.", 0.2),
    'That morning the city on the horizon lay dark and still. There was nothing left in it to burn.':
        ("Hushed and desolate, very slow.", 0.15),
    'When the sun came up, we said it to each other, one by one, all along the line. Bastion-7 is holding.':
        ("Quiet pride growing, the last sentence firm and moved.", 0.3),
    'At dawn, Aran told the sergeant it had been an honour. Kovac told him to save it. One more night.':
        ("Tender and bittersweet, a small smile on 'save it', resolute on 'One more night'.", 0.25),
    'And then the sun rose on the seventy-second hour. No aircraft came over the ridge. But we were still there.':
        ("Slow and deeply moved, voice catching with pride on 'But we were still there'.", 0.3),
    'The sun rose again. It did not care who was still alive to see it.':
        ("Bleak and philosophical, slow.", 0.15),
    'Dawn. We counted the living, then the dead, and then we stopped counting.':
        ("Weary, hollow, slow.", 0.15),
    'Another morning on the wall. Tomorrow they would come again. So would we.':
        ("Tired but stubborn, a quiet resolve on 'So would we'.", 0.22),
    'We had all come through the first night alive. We thought, God help us, that it might always be like that.':
        ('Quiet and rueful, an old man smiling sadly at his younger self.', 0.2),
    "The first names went on the list that night. Kovac wrote them himself, in pencil, so the rain wouldn't run them.":
        ("Slow and tender, sorrow held in check, a small catch on 'in pencil'.", 0.2),
    'Nobody was taken out of the fog that night. When it lifted, we counted heads twice to be sure.':
        ('Hushed relief, a faint disbelieving smile at the end.', 0.2),
    'In the fog, we only knew a man was gone when he stopped answering. We called their names until dawn.':
        ('Haunted and low, slowing on the last sentence.', 0.2),
    "We lost no one on the wall that night. It didn't feel like a victory, with her voice still in our ears.":
        ('Heavy and conflicted, quiet guilt at the end.', 0.2),
    'We buried our own beside the road that night, facing the overpass, as if they could still keep watch for her.':
        ('Gentle and grieving, very slow at the end.', 0.18),
    'Every man came back from the fourth night. The crows went hungry, for once.':
        ("Dry, grim satisfaction, a wry beat before 'for once'.", 0.22),
    'We paid for the fourth night in men, not supplies. The crate came cheaper than they did.':
        ('Bitter and quiet, the last sentence cold.', 0.22),
    "Not one of us fell on the giant's night. Afterwards we sat in the dark, too tired even to talk about it.":
        ('Exhausted wonder, quiet and slow.', 0.18),
    'The giant took men off the wall like a child takes toys from a shelf. We stopped looking at the empty places.':
        ('Low and shaken, haunted, the last sentence flat.', 0.25),
    'The stampede broke on the wall and never got over it. Every one of us was still there at roll call.':
        ('Grim pride rising, warm on the last sentence.', 0.3),
    'Some of the men who went down under the stampede never got back up. We heard the brutes long after they had stopped.':
        ('Dark and haunted, slow and heavy.', 0.22),
    "We came through the dark without losing a soul. Kovac said it was the first good luck we'd had in a week.":
        ("Weary warmth, a soft smile on Kovac's words.", 0.2),
    'We lost men in the dark that night, and in the dark we could not even see who. We found out at roll call.':
        ('Hollow and quiet, very slow at the end.', 0.18),
    'With Spectre gone, we lost no one else that night. It felt as if the dead were giving us a moment to mourn.':
        ('Soft and sorrowful, reflective.', 0.18),
    'Spectre was not the only loss that night. By dawn, the wall had names of its own to add to theirs.':
        ('Sombre and dignified, slow.', 0.2),
    'Against everything the valley had, not one man fell. Aran swore it would be the story he told his children.':
        ("Proud and moved, warm, a smile on 'his children'.", 0.3),
    'Everything we had, we gave. Some of us gave all of it. Their rifles stayed on the parapet where they fell.':
        ('Solemn and proud through grief, slow, weighted.', 0.25),
    'On the last night, every man who had made it this far made it to the end.':
        ('Deeply moved, quiet triumph, slow.', 0.3),
    'Some of us came so close to the end. Seventy-one hours, and then the night took them anyway.':
        ('Broken-hearted and quiet, a long pause before the last words.', 0.2),
    'Somewhere past midnight the gun found its rhythm. Kovac said he had never seen a fifty worked like that.':
        ('Grim admiration, low and steady.', 0.3),
    'They came out of the fog in columns, and the gun cut them down before they ever saw the wall.':
        ('Tense and vivid, low and rhythmic.', 0.35),
    'When the column from the overpass road came for the wall, the fifty swept the road clean from end to end.':
        ('Hard and vivid, a grim rhythm.', 0.35),
    'Around the strobe, the gun laid them down in a ring, row after row, like a fence made of the dead.':
        ('Dark, vivid and steady, a terrible image.', 0.35),
    'Even with the giant on the field, the gun never stopped talking. The smaller dead fell in heaps around its feet.':
        ('Intense and proud, building.', 0.4),
    'Under the stampede, the gun chewed through the runners until the barrel glowed like a stove.':
        ('Vivid and fierce, quickening.', 0.4),
    'In the dark, the gun was our only light. Every time it spoke, a dozen of them stopped coming.':
        ('Low and grimly poetic.', 0.3),
    "With no one above us any more, the fifty did Spectre's work as well as its own. The field was grey with them.":
        ('Grim pride with grief underneath.', 0.3),
    'That night the gun fired until the belts ran out, and then we fed it more, and the valley went quiet in rows.':
        ('Building intensity, then hushed at the end.', 0.4),
    'On the last night the gun spoke for all of us, and whatever came down that valley did not go back up it.':
        ('Fierce, proud and final.', 0.4),
    'We set the fog itself on fire. The bottles burst in the white, and the dead walked out of it burning.':
        ('Eerie and vivid, slow.', 0.35),
    'The overpass road burned all night. Whatever walked it to reach us burned with it.':
        ('Dark and cold, measured.', 0.3),
    'We ringed the drop zone with fire, and the dead walked into it rather than give up the crate.':
        ('Grim and vivid.', 0.35),
    "The wall base burned under the giant's feet. Even it screamed when the fuel caught.":
        ("Dark awe, a cold edge on 'Even it screamed'.", 0.35),
    'The brutes came through the fire without slowing. They just burned as they came.':
        ('Flat, haunted, slow.', 0.3),
    'In the blackout, our fires were the only light on the field. We could watch them burn, and that was all we could see.':
        ('Hushed and haunted.', 0.3),
    'With Spectre gone, the fire did its work for it. The foot of the wall burned from dusk until the sky went grey.':
        ('Grim and sorrowful.', 0.3),
    'We threw every bottle we had. The foot of the wall was one long fire, and still they kept walking into it.':
        ('Building, intense, then hollow at the end.', 0.4),
    # the ending
    'Extraction at the seventy-second hour, Command had said. Fifteen souls, or the birds would not fly. The hour came, and the sky stayed empty.':
        ('Slow and quiet, a bitter echo of an old promise; plain and heavy, the last sentence lands flat and final.', 0.2),
    'Kovac kept broadcasting anyway. Every hour, on every channel the set could reach, the same four words.':
        ('Warm, a faint smile of affection for a stubborn old friend, slow.', 0.25),
    'This is Bastion-7. Bastion-7 is holding.':
        ('Tired, hoarse and steady, a routine he has repeated a hundred times, quiet stubborn pride.', 0.3),
    "Bastion-7... we hear you. We can see your lights from the ridge. Please don't shoot. We're coming down.":
        ('Breathless with disbelief, hushed at first, then pleading and close to tears.', 0.5),
    'Bastion-7, there are forty of us at the old quarry. Is it true? Is the wall still standing?':
        ('Cautious, then a crack of desperate hope on the question.', 0.45),
    "It's standing. Keep to the road and come in slow. We've got you covered.":
        ('Firm and warm, a soldier who finally has good news to give; steady, reassuring.', 0.4),
    'They came all through that morning. Out of the hills, up the road, out of the dead city. Families. Stragglers. Soldiers with no unit left to go back to. The gate that had stayed shut for ten nights stood open until noon.':
        ('Rising wonder, a slow list told with growing warmth; gentle pride and emotion on the gate standing open.', 0.35),
    'Command had called us Bastion-7, one light in a line of many. But there was no line anymore. There were no other lights.':
        ('Reflective and quiet, sombre on the last sentence.', 0.2),
    'By the time the dead came down the valley again, nobody called it Bastion-7. They called it the Last Bastion.':
        ('Slow, building to quiet pride; a pause before the Last Bastion, spoken with weight, like a name.', 0.35),
    'And for as long as there was anyone left to man the wall... it held.':
        ('Very slow and hushed, the final words of the story; a long pause before it held, then soft and certain.', 0.25),
    'On the last night we set the valley floor alight, and it burned the way the city once had.':
        ('Slow, solemn and bitter.', 0.3),
    "There's a fuel tanker stalled out on the road. Let them crowd around it, then put a burst through the tank.":
        ("Calm and crafty, a sergeant's sly plan, low and quick.", 0.45),
    "The tanker's gone up! Look at them burn!":
        ('Shouting with fierce, savage glee.', 0.9),
    'They walked right past the tanker. Waste of good fuel.':
        ('Dry and disgusted, a grumble.', 0.3),
    "Bastion-7, Hollis! I've got a truck full of people from Halden and half the valley on my bumper. Open the gate!":
        ('Shouting over an engine, breathless and desperate, urgent.', 0.95),
    'Truck on the road! Clear a path for it — shoot whatever is in front of it!':
        ('Shouting orders, urgent and commanding.', 0.85),
    "We're in! We're in. Bastion-7, I owe every one of you a drink.":
        ('Breathless, laughing relief, then warm and grateful.', 0.6),
    "The truck's stopped... they're all over it. God help them.":
        ('Horrified, quiet and shaken, trailing off.', 0.35),
    "They're coming over the rocks on the left! Swing that gun!":
        ('Shouting in alarm, urgent.', 0.9),
    "They're coming over the rocks on the right! Swing that gun!":
        ('Shouting in alarm, urgent.', 0.9),
    'A fuel tanker stood abandoned on the road. We waited until they crowded round it, and then we lit it, and for a moment it was day.':
        ("Vivid storytelling, building, awe on 'for a moment it was day'.", 0.4),
    'A fuel tanker stood abandoned on the road all night. The dead shuffled past it, and we never found the moment to light it.':
        ('Wry and regretful, slow.', 0.2),
    'Hollis came back that night, driving a truck full of strangers from Halden. We cleared the road in front of him, and he drove it straight through the gate.':
        ('Warm and lively, rising to pride at the end.', 0.4),
    'Hollis came back that night with a truck full of strangers from Halden. The dead stopped it on the road, short of the gate, and we could not clear them fast enough.':
        ('Heavy with guilt, slow, quiet at the end.', 0.2),
    'That night they found the way round, down over the rocks at the end of the wall, where nobody had thought to look.':
        ('Low and ominous, measured.', 0.3),
    'Bastion-7 went quiet that night. The dead came over the wall like water through a broken dam, and the last light on the line went out.':
        ("Mournful and grave, an elegy, slowing to a whisper at the end.", 0.25),
    'No one was left to write it down. The gun fell silent before the dawn, and in the morning, the valley belonged to the dead.':
        ("Hushed and final, an epitaph, very slow.", 0.2),
    # ── the last night with enough of us: the extraction ─────────────────────
    'Bastion-7, Nightingale. Extraction flight is airborne, three lifters and escort. Hold that wall until we are overhead.':
        ("Calm, clear and warm, the first good news in days; steady professional pace, a firm promise on the last sentence.", 0.4),
    'Nightingale, two minutes out. Hammer flight is with us. Keep them off that wall, Bastion.':
        ("Focused and urgent but controlled, rotor noise behind her, encouraging on the last sentence.", 0.5),
    'They know. God help us, they know we are leaving. Everything is coming over that ridge — hold!':
        ("Horrified realisation, low at first, then rising to a desperate bellowed order on 'hold!' over gunfire.", 0.95),
    'Bastion-7, Reaper one-one, inbound with the lifters. Forty seconds. Just hold on.':
        ("Fast and tense, speaking over rotors, then softer and personal on 'Just hold on'.", 0.6),
    'Ten seconds, Bastion. Get your heads down.':
        ("Sharp, urgent and clipped, a warning.", 0.65),
    'Bastion-7, Nightingale. We are over the ridge. Hammer flight, you are cleared hot. Everything past the wire.':
        ("Commanding and crisp, rising intensity, a decisive order on 'cleared hot'.", 0.6),
    'Bring it down on them! Everyone off the wall — get your heads down!':
        ("Bellowing at the top of his lungs over gunfire and rotors, fierce and wild.", 1.0),
    'Hammer flight, in hot. Walking it up the valley. Bombs away, bombs away.':
        ("Crisp, fast, adrenaline under control, through an oxygen mask; punchy on 'bombs away'.", 0.65),
    'Reaper one-one, on station. We have the wall. Anything that moves down there is ours.':
        ("Cool, cocky and confident over the rotors, a hunter's grin in the voice.", 0.55),
    'Nightingale is on the ground. Ramp is down. Move, move, move!':
        ("Urgent and loud over the rotor wash, building to shouted 'Move, move, move!'", 0.85),
    "That's everyone. Bastion-7 is off the wall. Go, go!":
        ("Breathless and hoarse, relief and grief together, then a shouted 'Go, go!'", 0.8),
    'For ten nights we had held that wall. Now we ran from it, past the fires, toward the red light at the back of the ramp.':
        ("Quiet awe, a little faster than usual, remembering the rush; softening at 'the red light'.", 0.35),
    'We left the gun on the wall, still pointed down the valley. By the time we cleared the ridge, the dead were on the walkway where we had stood.':
        ("Slow and haunted, a long pause after the first sentence, the second almost a whisper.", 0.25),
    'Command had called us Bastion-7. The people we carried out of that valley called it something else. They called it the Last Bastion.':
        ("Warm, proud and measured, a storyteller's pause before 'the Last Bastion'.", 0.3),
    'And for seventy-two hours... it held.':
        ("Very slow and quiet, final and proud, a long pause before 'it held'.", 0.25),

    # ── the prologue: sunset before the first night (PROLOGUE, src/game/prologue.js) ──
    'When the cities fell, Command drew a line across the hills: a string of walls on the valley roads, to hold the dead back while the last flights got out.':
        ("Slow and grave, the very first words of a long story; unhurried, a small pause at the colon, quiet weight on 'the last flights'.", 0.22),
    'Ours was the seventh. A wall of concrete across the road, a gate, one heavy gun, and whoever was left to man it.':
        ("Measured, a dry, fond understatement, listing it plainly; a wry softness on 'whoever was left'.", 0.2),
    'Seventy-two hours, Command told us. Hold the valley for seventy-two hours, and the birds would come for us.':
        ("Quiet, a faint bitterness under it, an old man repeating a promise he no longer trusts.", 0.22),
    "Sarge... sun's going down.":
        ("Uneasy and quiet, half to himself, a young soldier watching the horizon; a nervous pause after 'Sarge'.", 0.25),
    "Then they'll be up soon. Lights on. Everybody on the wall.":
        ("Flat and steady, orders he has given many times before; no hurry, no drama, firm on 'Everybody on the wall'.", 0.35),
    'Every night the sun went down behind the burning city. And every night, the dead came out of it.':
        ("Low and haunted, slow; the second sentence colder and quieter.", 0.2),
    'Movement on the road. Here they come. Gunner — on the fifty.':
        ("Calm, clipped and controlled, tension under the steadiness; a short pause, then a firm order on 'on the fifty'.", 0.45),
    'That first night, there was only the wall, the dark, and the gun.':
        ("Very slow and quiet, a slow cadence on the last three things, a pause before 'and the gun'.", 0.2),

    # ── the hangar: a word as each requisition is set down at dawn (DELIVERY_LINES) ──
    "New barrel's on the bench, Sarge. Headspace and timing are set.":
        ("Dry and matter-of-fact, a craftsman quietly pleased with a job done properly.", 0.28),
    "Stiffer buffer spring's in. She'll cycle faster, so mind the heat.":
        ("Matter-of-fact, then a dry warning on 'mind the heat'.", 0.3),
    "Jacket's topped up. That barrel will run cooler tonight.":
        ("Calm and practical, unhurried, a small satisfied note at the end.", 0.25),
    "AP-T, belted and boxed. It'll go through two of them, maybe three.":
        ("Dry and deadpan, a grim little professional pride on 'maybe three'.", 0.3),
    'Incendiary belts. Anything you hit tonight might start burning.':
        ("Deadpan, a faint dark amusement under the practicality.", 0.3),
    "HE-I. Every round goes off when it hits. Don't drop that crate.":
        ("Matter-of-fact, then sharper and wary on 'Don't drop that crate', a man who means it.", 0.38),
    "Bastion, Battery. Second section's laid and ready. More tubes on every mission.":
        ("Brisk radio procedure with an upbeat edge, good news delivered quickly.", 0.4),
    "Fire direction's set up properly now. We'll turn your calls around faster.":
        ("Brisk and confident, clipped, a little pride in the work.", 0.38),
    'Heavy charges are in. A bigger bang where you want it.':
        ("Clipped and businesslike, a hint of a grin on 'a bigger bang'.", 0.4),
    'Another crew for the wall. Put them on a gun and keep them fed.':
        ("Gruff and plain, a sergeant handing out a practical order, steady, not loud.", 0.35),
    "The crews spent the morning on the range. They'll shoot straighter tonight.":
        ("Gruff, steady, a quiet note of approval he would never say outright.", 0.32),
    'More wire going out, Sarge. Mind your feet past the ditch.':
        ("Quiet and a little earnest, a young soldier trying to be helpful.", 0.25),
    'Another crate of grenades. Pins in, please.':
        ("Dry and tired, deadpan; 'please' as a weary, pointed request.", 0.25),
    "More bottles. Don't ask what was in them before.":
        ("Deadpan, dry gallows humour, unhurried.", 0.25),
    'Thickened the fuel with soap flakes. It sticks now.':
        ("Matter-of-fact, a quiet craftsman's satisfaction on 'It sticks now'.", 0.25),
    'Claymores going out. Front toward enemy, I checked twice.':
        ("Earnest and slightly nervous, a young soldier proud he got it right; a small hurried laugh at the end.", 0.3),
}

def direction(who, text):
    d, intensity = DIRECTION.get(text, DEFAULT[who])
    return d, intensity
