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
    'REACH 3-1': ("Calm, warm, professional pilot radio call.", 0.3),
    'NARRATOR': ("Slow, low and measured, an old man remembering; quiet gravity, unhurried pauses between the sentences.", 0.22),
}

# text -> (direction, intensity)
DIRECTION = {
    # ── night-by-night story ───────────────────────────────────────────────
    'Bastion-7, this is Command. Relief column departs at dawn. Hold for seventy-two hours.':
        ("Calm, confident and businesslike, a routine order, the officer still believes help is coming.", 0.3),
    'You heard the man. Seventy-two hours. Keep that barrel cool and the wall clean.':
        ("Gruff and dry, half a smirk, rallying his men with easy authority. Steady pace.", 0.4),
    'Bastion-7, relief column delayed. Bridge at Halden is down. Keep the gate shut.':
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
    'Bastion-7... relief column has been... (static) ...rerouted. Hold position.':
        ("Halting and evasive, an officer reading an order he does not believe; tired, flat.", 0.25),
    'Rerouted. Sure. Load the belt.':
        ("Bitter, sardonic and dry, a tired scoff, then flat and practical.", 0.3),
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
    'Seventy-two hours. This is the last night. Whatever comes down that valley — we are still here.':
        ("Slow, proud and defiant, a final rallying speech, building to a fierce, quiet strength on 'we are still here'.", 0.5),
    'If anyone is listening: Bastion-7 is holding. Bastion-7 is holding.':
        ("Exhausted but unbroken, broadcasting into the dark; the second time quieter and more personal.", 0.35),
    'No relief. No orders. Just the night, and the gun.':
        ("Low, weary, almost meditative, a man who has accepted his fate.", 0.25),
    'Count the survivors. Then count the dead out there. Keep counting.':
        ("Grim, bone-tired and bitter, flat and slow.", 0.3),
    'I stopped writing their names down.':
        ("Quiet, hollow and numb, a confession, almost a whisper.", 0.15),
    "They'll come again tomorrow. So will we.":
        ("Tired, stoic, a grim half-smile, quiet resolve.", 0.3),
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
    "Bastion-7, Spectre two-one on station overhead. We'll work the crowds in the field — you hold that wall.":
        ("Calm, cool and reassuring, a confident routine radio call with a hint of a smile.", 0.35),
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
    "Bastion-7, Spectre two-two on station. Two-one were friends of ours. Let's make them pay for it.":
        ("Steady and professional, then low and grieving on 'friends of ours', and cold, hard anger on the last sentence.", 0.45),
    'We see it, Bastion. Putting everything we have on the big one.':
        ("Serious, focused and determined, the calm cracking a little.", 0.5),
    'Spectre is blind in this soup. Holding fire until it clears.':
        ("Frustrated, dry and calm.", 0.35),
    "We have you on thermals, Bastion. We'll be your eyes.":
        ("Warm, reassuring and steady.", 0.3),
    "Mayday, mayday! Spectre two-one, fire in number three — we've lost hydraulics — we're going down!":
        ("Screaming a mayday call in terror, frantic and breathless, all the calm gone, alarms in the cockpit.", 1.0),
    # ── unlock briefings ──────────────────────────────────────────────────
    "Engineers found a crate of bottles and a jerrycan in the depot. E throws a Molotov — put it on the wall base and let them burn. And there's a crate of grenades at your feet. G, for anything climbing.":
        ("Practical, gruff briefing, with grim satisfaction, conversational.", 0.35),
    'Bastion-7, Command. You now have a one-oh-five battery on call. Q puts a fire mission wherever you are looking.':
        ("Composed, formal and businesslike briefing.", 0.3),
    'Flares came up with the shells. F puts one over the field — anything in the light goes down easier.':
        ("Practical gruff briefing, a little approving.", 0.35),
    "Bastion-7, Hammer one-one is on call tonight. Throw a red flare where you want it — that's T — and keep your heads down.":
        ("Confident, crisp and friendly pilot radio call.", 0.4),
    'Listen. If it all goes wrong, B brings the guns down on our own wall line. It will cost us men. Use it only if the wall is lost.':
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
    'On the second night, word came that the bridge at Halden was down. The relief would be late. Only late, we told ourselves.':
        ("Measured and weary, a wry, sad smile on 'Only late, we told ourselves'.", 0.2),
    "The third night began with a woman's voice on the radio, begging for help that we could not give.":
        ("Low and heavy with old guilt, slowing down at the end.", 0.2),
    'On the fourth night, Command promised us an airdrop. The bloaters came down the valley to meet it.':
        ("Dry and grim, measured storytelling with a bitter edge.", 0.22),
    'On the fifth night, Bastion-3 fell, and Bastion-5 went silent. We were the last lights left on the line.':
        ("Hushed and solemn, a long pause before the last sentence, quiet and lonely.", 0.2),
    'On the sixth night, the radio told us the relief column had been rerouted. Nobody on the wall believed it.':
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
    'At dawn, Kovac loaded a fresh belt without a word. Nobody said rerouted out loud again.':
        ("Dry, quiet and wry, an old soldier's understatement.", 0.2),
    'That morning the city on the horizon lay dark and still. There was nothing left in it to burn.':
        ("Hushed and desolate, very slow.", 0.15),
    'When the sun came up, we said it to each other, one by one, all along the line. Bastion-7 is holding.':
        ("Quiet pride growing, the last sentence firm and moved.", 0.3),
    'At dawn, Aran told the sergeant it had been an honour. Kovac told him to save it. One more night.':
        ("Tender and bittersweet, a small smile on 'save it', resolute on 'One more night'.", 0.25),
    'And then the sun rose on the seventy-second hour. No column came down the road. But we were still there.':
        ("Slow and deeply moved, voice catching with pride on 'But we were still there'.", 0.3),
    'The sun rose again. It did not care who was still alive to see it.':
        ("Bleak and philosophical, slow.", 0.15),
    'Dawn. We counted the living, then the dead, and then we stopped counting.':
        ("Weary, hollow, slow.", 0.15),
    'Another morning on the wall. Tomorrow they would come again. So would we.':
        ("Tired but stubborn, a quiet resolve on 'So would we'.", 0.22),
    'Bastion-7 went quiet that night. The dead came over the wall like water through a broken dam, and the last light on the line went out.':
        ("Mournful and grave, an elegy, slowing to a whisper at the end.", 0.25),
    'No one was left to write it down. The gun fell silent before the dawn, and in the morning, the valley belonged to the dead.':
        ("Hushed and final, an epitaph, very slow.", 0.2),
}


def direction(who, text):
    d, intensity = DIRECTION.get(text, DEFAULT[who])
    return d, intensity
