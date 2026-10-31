// The built-in exercise catalogue: the GYM half -- strength, power, Olympic
// lifting, plyometrics, isometrics, loaded carries and core.
//
// Separate from js/catalog.js (which parses and searches this) so that neither
// file fights the 1000-line cap: mechanism there, data here. Nothing in this
// file is state -- it ships with the app, is never written to, and a user's own
// exercises live in their own library (js/exercisestore.js) alongside it.
//
// ONE LINE PER EXERCISE, six pipe-separated fields:
//
//   Name | category | equipment | measure[:flags] | primary | secondary,…
//
// category   what KIND of training this is, and the mark shown on every row:
//            strength power olympic plyo isometric carry core
//            running cardio mobility rehab
// equipment  barbell dumbbell kettlebell machine cable smith trapbar landmine
//            ez bodyweight band ring trx ball sled rope wheel none
// measure    reps | time | distance | cardio       (see js/measure.js)
// flags      bw  = the load is your own bodyweight
//            uni = unilateral, one side at a time
// primary    the volume group, counted as DIRECT sets in Trends
// secondary  other muscles worked, counted as INDIRECT sets
//
// `measure` and `bw` are deliberately independent: a plank is time+bw, a
// weighted plank is time with external load, a push-up is reps+bw. No single
// three-way label can say that, which is why there are two fields.
//
// Running, other cardio, mobility and prehab live in js/catalogconditioning.js
// -- same format, split only so neither file passes the 1000-line cap.
export const CATALOG_LINES = `
# ---------------- squat / knee-dominant strength ----------------
Back Squat|strength|barbell|reps|Quads|Glutes,Core
High-bar Back Squat|strength|barbell|reps|Quads|Glutes,Core
Low-bar Back Squat|strength|barbell|reps|Quads|Glutes,Lower Back
Front Squat|strength|barbell|reps|Quads|Core,Glutes
Zercher Squat|strength|barbell|reps|Quads|Core,Lower Back
Safety Bar Squat|strength|barbell|reps|Quads|Glutes,Lower Back
Box Squat|strength|barbell|reps|Quads|Glutes,Hamstrings
Pause Squat|strength|barbell|reps|Quads|Glutes,Core
Tempo Squat|strength|barbell|reps|Quads|Glutes,Core
Pin Squat|strength|barbell|reps|Quads|Glutes
Anderson Squat|strength|barbell|reps|Quads|Glutes
Overhead Squat|olympic|barbell|reps|Quads|Shoulders,Core
Goblet Squat|strength|kettlebell|reps|Quads|Glutes,Core
Dumbbell Squat|strength|dumbbell|reps|Quads|Glutes
Hack Squat|strength|machine|reps|Quads|Glutes
Pendulum Squat|strength|machine|reps|Quads|Glutes
Smith Machine Squat|strength|smith|reps|Quads|Glutes
Leg Press|strength|machine|reps|Quads|Glutes
Single-leg Leg Press|strength|machine|reps:uni|Quads|Glutes
Belt Squat|strength|machine|reps|Quads|Glutes
Sissy Squat|strength|bodyweight|reps:bw|Quads|
Spanish Squat|strength|band|reps:bw|Quads|
Cyclist Squat|strength|barbell|reps|Quads|Glutes
Heels-elevated Goblet Squat|strength|kettlebell|reps|Quads|Glutes
Air Squat|strength|bodyweight|reps:bw|Quads|Glutes
Pistol Squat|strength|bodyweight|reps:bw:uni|Quads|Glutes,Core
Bulgarian Split Squat|strength|dumbbell|reps:uni|Quads|Glutes
Split Squat|strength|dumbbell|reps:uni|Quads|Glutes
ATG Split Squat|strength|bodyweight|reps:bw:uni|Quads|Glutes
Front Foot Elevated Split Squat|strength|dumbbell|reps:uni|Quads|Glutes
Walking Lunge|strength|dumbbell|reps:uni|Quads|Glutes
Reverse Lunge|strength|dumbbell|reps:uni|Quads|Glutes
Forward Lunge|strength|dumbbell|reps:uni|Quads|Glutes
Lateral Lunge|strength|dumbbell|reps:uni|Quads|Adductors
Curtsy Lunge|strength|dumbbell|reps:uni|Glutes|Quads
Deficit Reverse Lunge|strength|dumbbell|reps:uni|Quads|Glutes
Step-up|strength|dumbbell|reps:uni|Quads|Glutes
Lateral Step-up|strength|dumbbell|reps:uni|Glutes|Quads
Box Step-over|strength|dumbbell|reps:uni|Quads|Glutes
Leg Extension|strength|machine|reps|Quads|
Single-leg Leg Extension|strength|machine|reps:uni|Quads|
Reverse Nordic Curl|strength|bodyweight|reps:bw|Quads|

# ---------------- hinge / posterior chain ----------------
Conventional Deadlift|strength|barbell|reps|Hamstrings|Glutes,Lower Back
Sumo Deadlift|strength|barbell|reps|Glutes|Quads,Adductors
Romanian Deadlift|strength|barbell|reps|Hamstrings|Glutes,Lower Back
Stiff-leg Deadlift|strength|barbell|reps|Hamstrings|Lower Back
Deficit Deadlift|strength|barbell|reps|Hamstrings|Glutes,Lower Back
Rack Pull|strength|barbell|reps|Back|Glutes,Traps
Block Pull|strength|barbell|reps|Hamstrings|Back,Glutes
Trap Bar Deadlift|strength|trapbar|reps|Quads|Glutes,Back
Snatch-grip Deadlift|strength|barbell|reps|Back|Hamstrings,Traps
Dumbbell Romanian Deadlift|strength|dumbbell|reps|Hamstrings|Glutes
Single-leg Romanian Deadlift|strength|dumbbell|reps:uni|Hamstrings|Glutes,Core
Kettlebell Deadlift|strength|kettlebell|reps|Hamstrings|Glutes
Good Morning|strength|barbell|reps|Hamstrings|Lower Back,Glutes
Seated Good Morning|strength|barbell|reps|Lower Back|Hamstrings
Jefferson Curl|mobility|barbell|reps|Lower Back|Hamstrings
Kang Squat|strength|barbell|reps|Hamstrings|Quads,Lower Back
Hip Thrust|strength|barbell|reps|Glutes|Hamstrings
Single-leg Hip Thrust|strength|bodyweight|reps:bw:uni|Glutes|Hamstrings
Barbell Glute Bridge|strength|barbell|reps|Glutes|Hamstrings
Glute Bridge|strength|bodyweight|reps:bw|Glutes|Hamstrings
Frog Pump|strength|bodyweight|reps:bw|Glutes|
Back Extension|strength|machine|reps:bw|Lower Back|Glutes,Hamstrings
45-degree Back Extension|strength|machine|reps:bw|Lower Back|Glutes
Reverse Hyperextension|strength|machine|reps:bw|Glutes|Lower Back
Nordic Hamstring Curl|strength|bodyweight|reps:bw|Hamstrings|
Glute-ham Raise|strength|machine|reps:bw|Hamstrings|Glutes
Seated Leg Curl|strength|machine|reps|Hamstrings|
Lying Leg Curl|strength|machine|reps|Hamstrings|
Standing Leg Curl|strength|machine|reps:uni|Hamstrings|
Kettlebell Swing|power|kettlebell|reps|Glutes|Hamstrings,Core
Single-arm Kettlebell Swing|power|kettlebell|reps:uni|Glutes|Hamstrings,Core
Cable Pull-through|strength|cable|reps|Glutes|Hamstrings
Hip Abduction Machine|strength|machine|reps|Abductors|Glutes
Hip Adduction Machine|strength|machine|reps|Adductors|
Kickback|strength|cable|reps:uni|Glutes|Hamstrings

# ---------------- horizontal push ----------------
Barbell Bench Press|strength|barbell|reps|Chest|Triceps,Shoulders
Close-grip Bench Press|strength|barbell|reps|Triceps|Chest
Wide-grip Bench Press|strength|barbell|reps|Chest|Shoulders
Incline Barbell Bench Press|strength|barbell|reps|Chest|Shoulders,Triceps
Decline Barbell Bench Press|strength|barbell|reps|Chest|Triceps
Floor Press|strength|barbell|reps|Triceps|Chest
Larsen Press|strength|barbell|reps|Chest|Triceps
Spoto Press|strength|barbell|reps|Chest|Triceps
Board Press|strength|barbell|reps|Triceps|Chest
Pin Press|strength|barbell|reps|Triceps|Chest,Shoulders
Dumbbell Bench Press|strength|dumbbell|reps|Chest|Triceps,Shoulders
Incline Dumbbell Bench Press|strength|dumbbell|reps|Chest|Shoulders
Decline Dumbbell Press|strength|dumbbell|reps|Chest|Triceps
Neutral-grip Dumbbell Press|strength|dumbbell|reps|Chest|Triceps
Single-arm Dumbbell Bench Press|strength|dumbbell|reps:uni|Chest|Core
Machine Chest Press|strength|machine|reps|Chest|Triceps
Incline Machine Press|strength|machine|reps|Chest|Shoulders
Hammer Strength Chest Press|strength|machine|reps|Chest|Triceps
Smith Machine Bench Press|strength|smith|reps|Chest|Triceps
Landmine Press|strength|landmine|reps:uni|Shoulders|Chest,Core
Svend Press|strength|dumbbell|reps|Chest|
Push-up|strength|bodyweight|reps:bw|Chest|Triceps,Core
Incline Push-up|strength|bodyweight|reps:bw|Chest|Triceps
Decline Push-up|strength|bodyweight|reps:bw|Chest|Shoulders
Deficit Push-up|strength|bodyweight|reps:bw|Chest|Triceps
Diamond Push-up|strength|bodyweight|reps:bw|Triceps|Chest
Wide Push-up|strength|bodyweight|reps:bw|Chest|Shoulders
Archer Push-up|strength|bodyweight|reps:bw:uni|Chest|Triceps
One-arm Push-up|strength|bodyweight|reps:bw:uni|Chest|Core
Ring Push-up|strength|ring|reps:bw|Chest|Core
Pseudo Planche Push-up|strength|bodyweight|reps:bw|Chest|Shoulders
Dip|strength|bodyweight|reps:bw|Chest|Triceps
Ring Dip|strength|ring|reps:bw|Chest|Triceps
Bench Dip|strength|bodyweight|reps:bw|Triceps|Chest
Cable Fly|strength|cable|reps|Chest|
Low-to-high Cable Fly|strength|cable|reps|Chest|
High-to-low Cable Fly|strength|cable|reps|Chest|
Dumbbell Fly|strength|dumbbell|reps|Chest|
Incline Dumbbell Fly|strength|dumbbell|reps|Chest|
Pec Deck|strength|machine|reps|Chest|
Machine Fly|strength|machine|reps|Chest|

# ---------------- vertical push ----------------
Overhead Press|strength|barbell|reps|Shoulders|Triceps,Core
Seated Barbell Press|strength|barbell|reps|Shoulders|Triceps
Push Press|power|barbell|reps|Shoulders|Quads,Triceps
Behind-the-neck Press|strength|barbell|reps|Shoulders|Triceps
Z Press|strength|barbell|reps|Shoulders|Core
Dumbbell Shoulder Press|strength|dumbbell|reps|Shoulders|Triceps
Seated Dumbbell Shoulder Press|strength|dumbbell|reps|Shoulders|Triceps
Arnold Press|strength|dumbbell|reps|Shoulders|Triceps
Single-arm Dumbbell Press|strength|dumbbell|reps:uni|Shoulders|Core
Machine Shoulder Press|strength|machine|reps|Shoulders|Triceps
Smith Machine Overhead Press|strength|smith|reps|Shoulders|Triceps
Kettlebell Press|strength|kettlebell|reps:uni|Shoulders|Triceps,Core
Bottoms-up Kettlebell Press|strength|kettlebell|reps:uni|Shoulders|Forearms,Core
Landmine Shoulder Press|strength|landmine|reps:uni|Shoulders|Core
Viking Press|strength|machine|reps|Shoulders|Triceps
Pike Push-up|strength|bodyweight|reps:bw|Shoulders|Triceps
Handstand Push-up|strength|bodyweight|reps:bw|Shoulders|Triceps,Core

# ---------------- vertical pull ----------------
Pull-up|strength|bodyweight|reps:bw|Lats|Biceps,Forearms
Chin-up|strength|bodyweight|reps:bw|Lats|Biceps
Neutral-grip Pull-up|strength|bodyweight|reps:bw|Lats|Biceps
Wide-grip Pull-up|strength|bodyweight|reps:bw|Lats|Back
Weighted Pull-up|strength|bodyweight|reps:bw|Lats|Biceps
Assisted Pull-up|strength|machine|reps|Lats|Biceps
Archer Pull-up|strength|bodyweight|reps:bw:uni|Lats|Biceps
Muscle-up|power|bodyweight|reps:bw|Lats|Chest,Triceps
Rope Climb|strength|rope|reps:bw|Lats|Forearms,Biceps
Lat Pulldown|strength|cable|reps|Lats|Biceps
Wide-grip Lat Pulldown|strength|cable|reps|Lats|Back
Close-grip Lat Pulldown|strength|cable|reps|Lats|Biceps
Neutral-grip Pulldown|strength|cable|reps|Lats|Biceps
Single-arm Lat Pulldown|strength|cable|reps:uni|Lats|Biceps
Kneeling Lat Pulldown|strength|cable|reps|Lats|Core
Straight-arm Pulldown|strength|cable|reps|Lats|
Dumbbell Pullover|strength|dumbbell|reps|Lats|Chest
Machine Pullover|strength|machine|reps|Lats|

# ---------------- horizontal pull ----------------
Barbell Row|strength|barbell|reps|Back|Lats,Biceps
Pendlay Row|strength|barbell|reps|Back|Lats
Yates Row|strength|barbell|reps|Back|Biceps
Single-arm Dumbbell Row|strength|dumbbell|reps:uni|Back|Lats,Biceps
Chest-supported Row|strength|dumbbell|reps|Back|Rear Delts
Seal Row|strength|barbell|reps|Back|Lats
Seated Cable Row|strength|cable|reps|Back|Biceps
Wide-grip Seated Row|strength|cable|reps|Back|Rear Delts
Single-arm Cable Row|strength|cable|reps:uni|Back|Lats
Machine Row|strength|machine|reps|Back|Biceps
Hammer Strength Row|strength|machine|reps|Back|Lats
T-bar Row|strength|barbell|reps|Back|Lats
Landmine Row|strength|landmine|reps:uni|Back|Lats
Meadows Row|strength|landmine|reps:uni|Back|Lats
Kroc Row|strength|dumbbell|reps:uni|Back|Forearms
Inverted Row|strength|bodyweight|reps:bw|Back|Biceps
Ring Row|strength|ring|reps:bw|Back|Biceps
TRX Row|strength|trx|reps:bw|Back|Biceps
Face Pull|strength|cable|reps|Rear Delts|Traps
Cable Rear Delt Fly|strength|cable|reps|Rear Delts|
Reverse Pec Deck|strength|machine|reps|Rear Delts|
Dumbbell Rear Delt Fly|strength|dumbbell|reps|Rear Delts|
Shrug|strength|barbell|reps|Traps|
Dumbbell Shrug|strength|dumbbell|reps|Traps|
Trap Bar Shrug|strength|trapbar|reps|Traps|
Cable Shrug|strength|cable|reps|Traps|

# ---------------- shoulders, lateral and front ----------------
Dumbbell Lateral Raise|strength|dumbbell|reps|Shoulders|
Cable Lateral Raise|strength|cable|reps:uni|Shoulders|
Machine Lateral Raise|strength|machine|reps|Shoulders|
Leaning Lateral Raise|strength|dumbbell|reps:uni|Shoulders|
Front Raise|strength|dumbbell|reps|Shoulders|
Plate Front Raise|strength|dumbbell|reps|Shoulders|
Upright Row|strength|barbell|reps|Traps|Shoulders
Cable Upright Row|strength|cable|reps|Traps|Shoulders

# ---------------- biceps ----------------
Barbell Curl|strength|barbell|reps|Biceps|Forearms
EZ-bar Curl|strength|ez|reps|Biceps|Forearms
Dumbbell Curl|strength|dumbbell|reps|Biceps|Forearms
Alternating Dumbbell Curl|strength|dumbbell|reps:uni|Biceps|Forearms
Hammer Curl|strength|dumbbell|reps|Biceps|Forearms
Incline Dumbbell Curl|strength|dumbbell|reps|Biceps|
Preacher Curl|strength|ez|reps|Biceps|
Spider Curl|strength|dumbbell|reps|Biceps|
Concentration Curl|strength|dumbbell|reps:uni|Biceps|
Cable Curl|strength|cable|reps|Biceps|Forearms
Bayesian Curl|strength|cable|reps:uni|Biceps|
Machine Curl|strength|machine|reps|Biceps|
Zottman Curl|strength|dumbbell|reps|Biceps|Forearms
Reverse Curl|strength|barbell|reps|Forearms|Biceps
Drag Curl|strength|barbell|reps|Biceps|
Chin-up Curl|strength|bodyweight|reps:bw|Biceps|Lats

# ---------------- triceps ----------------
Skull Crusher|strength|ez|reps|Triceps|
Dumbbell Skull Crusher|strength|dumbbell|reps|Triceps|
Overhead Cable Extension|strength|cable|reps|Triceps|
Overhead Dumbbell Extension|strength|dumbbell|reps|Triceps|
Single-arm Overhead Extension|strength|dumbbell|reps:uni|Triceps|
Cable Pushdown|strength|cable|reps|Triceps|
Rope Pushdown|strength|cable|reps|Triceps|
Single-arm Pushdown|strength|cable|reps:uni|Triceps|
Triceps Kickback|strength|dumbbell|reps:uni|Triceps|
JM Press|strength|barbell|reps|Triceps|
Tate Press|strength|dumbbell|reps|Triceps|
Machine Triceps Extension|strength|machine|reps|Triceps|

# ---------------- forearms, grip, neck, calves ----------------
Wrist Curl|strength|barbell|reps|Forearms|
Reverse Wrist Curl|strength|barbell|reps|Forearms|
Dumbbell Wrist Curl|strength|dumbbell|reps|Forearms|
Wrist Roller|strength|rope|reps|Forearms|
Hand Gripper|strength|none|reps|Forearms|
Neck Curl|strength|none|reps|Neck|
Neck Extension|strength|none|reps|Neck|
Neck Harness Extension|strength|none|reps|Neck|
Standing Calf Raise|strength|machine|reps|Calves|
Seated Calf Raise|strength|machine|reps|Calves|
Leg Press Calf Raise|strength|machine|reps|Calves|
Smith Machine Calf Raise|strength|smith|reps|Calves|
Donkey Calf Raise|strength|machine|reps|Calves|
Single-leg Calf Raise|strength|bodyweight|reps:bw:uni|Calves|

# ---------------- core, in reps ----------------
Crunch|core|bodyweight|reps:bw|Core|
Cable Crunch|core|cable|reps|Core|
Sit-up|core|bodyweight|reps:bw|Core|
Decline Sit-up|core|bodyweight|reps:bw|Core|
Hanging Leg Raise|core|bodyweight|reps:bw|Core|Forearms
Hanging Knee Raise|core|bodyweight|reps:bw|Core|Forearms
Lying Leg Raise|core|bodyweight|reps:bw|Core|
Captain's Chair Leg Raise|core|bodyweight|reps:bw|Core|
Toes-to-bar|core|bodyweight|reps:bw|Core|Lats
V-up|core|bodyweight|reps:bw|Core|
Reverse Crunch|core|bodyweight|reps:bw|Core|
Bicycle Crunch|core|bodyweight|reps:bw|Core|Obliques
Russian Twist|core|ball|reps|Obliques|Core
Cable Woodchop|core|cable|reps:uni|Obliques|Core
Pallof Press|core|cable|reps:uni|Core|Obliques
Ab Wheel Rollout|core|wheel|reps:bw|Core|Lats
Dragon Flag|core|bodyweight|reps:bw|Core|
Hollow Rock|core|bodyweight|reps:bw|Core|
Dead Bug|core|bodyweight|reps:bw|Core|
Bird Dog|core|bodyweight|reps:bw:uni|Core|Lower Back
Side Bend|core|dumbbell|reps:uni|Obliques|
Windshield Wiper|core|bodyweight|reps:bw|Obliques|Core
Mountain Climber|core|bodyweight|reps:bw|Core|Quads
Sit-up with Twist|core|bodyweight|reps:bw|Obliques|Core
Jackknife|core|bodyweight|reps:bw|Core|

# ---------------- isometrics: measured in TIME, not reps ----------------
Front Plank|isometric|bodyweight|time:bw|Core|Shoulders
Side Plank|isometric|bodyweight|time:bw:uni|Obliques|Core
RKC Plank|isometric|bodyweight|time:bw|Core|Glutes
Long-lever Plank|isometric|bodyweight|time:bw|Core|Shoulders
Plank with Shoulder Tap|isometric|bodyweight|time:bw|Core|Shoulders
Copenhagen Plank|isometric|bodyweight|time:bw:uni|Adductors|Core
Weighted Plank|isometric|none|time|Core|Shoulders
Hollow Hold|isometric|bodyweight|time:bw|Core|
Superman Hold|isometric|bodyweight|time:bw|Lower Back|Glutes
Prone Cobra|isometric|bodyweight|time:bw|Lower Back|Traps
Bear Hold|isometric|bodyweight|time:bw|Core|Shoulders
Wall Press Dead Bug|isometric|bodyweight|time:bw|Core|
Pallof Hold|isometric|cable|time:uni|Core|Obliques
L-sit|isometric|bodyweight|time:bw|Core|Quads
Tuck L-sit|isometric|bodyweight|time:bw|Core|
Dead Hang|isometric|bodyweight|time:bw|Forearms|Lats
Active Hang|isometric|bodyweight|time:bw|Lats|Forearms
Single-arm Hang|isometric|bodyweight|time:bw:uni|Forearms|Lats
Plate Pinch|isometric|none|time|Forearms|
Wall Sit|isometric|bodyweight|time:bw|Quads|Glutes
Horse Stance|isometric|bodyweight|time:bw|Quads|Adductors
Isometric Squat Hold|isometric|bodyweight|time:bw|Quads|Glutes
Split Squat Hold|isometric|bodyweight|time:bw:uni|Quads|Glutes
Isometric Lunge Hold|isometric|bodyweight|time:bw:uni|Quads|Glutes
Glute Bridge Hold|isometric|bodyweight|time:bw|Glutes|Hamstrings
Single-leg Glute Bridge Hold|isometric|bodyweight|time:bw:uni|Glutes|Hamstrings
Hip Thrust Hold|isometric|barbell|time|Glutes|Hamstrings
Nordic Hold|isometric|bodyweight|time:bw|Hamstrings|
Calf Raise Hold|isometric|bodyweight|time:bw|Calves|
Single-leg Balance|isometric|bodyweight|time:bw:uni|Calves|Core
Handstand Hold|isometric|bodyweight|time:bw|Shoulders|Core
Wall Handstand Hold|isometric|bodyweight|time:bw|Shoulders|Core
Headstand|isometric|bodyweight|time:bw|Shoulders|Core
Crow Pose|isometric|bodyweight|time:bw|Shoulders|Core
Front Lever Hold|isometric|bodyweight|time:bw|Lats|Core
Tuck Front Lever|isometric|bodyweight|time:bw|Lats|Core
Back Lever Hold|isometric|bodyweight|time:bw|Chest|Lats
Planche Hold|isometric|bodyweight|time:bw|Shoulders|Chest
Tuck Planche|isometric|bodyweight|time:bw|Shoulders|Chest
Iron Cross|isometric|ring|time:bw|Chest|Shoulders
Support Hold|isometric|bodyweight|time:bw|Triceps|Shoulders
Ring Support Hold|isometric|ring|time:bw|Shoulders|Triceps
Chin-up Hold|isometric|bodyweight|time:bw|Biceps|Lats
Overcoming Isometric Bench Press|isometric|barbell|time|Chest|Triceps
Isometric Mid-thigh Pull|isometric|barbell|time|Back|Hamstrings
Suitcase Hold|isometric|dumbbell|time:uni|Forearms|Obliques
Front Rack Hold|isometric|barbell|time|Core|Traps
Overhead Hold|isometric|barbell|time|Shoulders|Core
Yoke Hold|isometric|none|time|Traps|Core
Bottoms-up Hold|isometric|kettlebell|time:uni|Forearms|Shoulders

# ---------------- loaded carries: measured in DISTANCE ----------------
Farmer Carry|carry|dumbbell|distance|Forearms|Traps,Core
Single-arm Farmer Carry|carry|dumbbell|distance:uni|Forearms|Obliques
Suitcase Carry|carry|kettlebell|distance:uni|Obliques|Forearms
Front Rack Carry|carry|kettlebell|distance|Core|Traps
Overhead Carry|carry|dumbbell|distance|Shoulders|Core
Waiter Walk|carry|kettlebell|distance:uni|Shoulders|Core
Trap Bar Carry|carry|trapbar|distance|Forearms|Traps
Yoke Walk|carry|none|distance|Traps|Core
Sandbag Carry|carry|none|distance|Core|Forearms
Sled Push|carry|sled|distance|Quads|Glutes
Sled Drag|carry|sled|distance|Quads|Hamstrings
Backward Sled Drag|carry|sled|distance|Quads|
Weighted Walk|carry|none|distance|Calves|Core
Bear Crawl|carry|bodyweight|distance:bw|Core|Shoulders
Crab Walk|carry|bodyweight|distance:bw|Triceps|Core
Duck Walk|carry|bodyweight|distance:bw|Quads|

# ---------------- olympic lifting ----------------
Clean and Jerk|olympic|barbell|reps|Full Body|Quads,Shoulders
Power Clean|olympic|barbell|reps|Full Body|Quads,Traps
Hang Clean|olympic|barbell|reps|Full Body|Traps
Hang Power Clean|olympic|barbell|reps|Full Body|Traps
Squat Clean|olympic|barbell|reps|Full Body|Quads
Muscle Clean|olympic|barbell|reps|Traps|Shoulders
Clean Pull|olympic|barbell|reps|Traps|Hamstrings
Clean High Pull|olympic|barbell|reps|Traps|Shoulders
Snatch|olympic|barbell|reps|Full Body|Shoulders,Traps
Power Snatch|olympic|barbell|reps|Full Body|Shoulders
Hang Snatch|olympic|barbell|reps|Full Body|Traps
Hang Power Snatch|olympic|barbell|reps|Full Body|Shoulders
Muscle Snatch|olympic|barbell|reps|Shoulders|Traps
Snatch Pull|olympic|barbell|reps|Traps|Hamstrings
Split Jerk|olympic|barbell|reps|Shoulders|Quads
Power Jerk|olympic|barbell|reps|Shoulders|Quads
Push Jerk|olympic|barbell|reps|Shoulders|Quads
Jerk Dip|olympic|barbell|reps|Quads|Shoulders
Jerk Balance|olympic|barbell|reps|Shoulders|Quads
Behind-the-neck Jerk|olympic|barbell|reps|Shoulders|Quads
High Pull|olympic|barbell|reps|Traps|Shoulders
Dumbbell Snatch|power|dumbbell|reps:uni|Full Body|Shoulders
Dumbbell Clean|power|dumbbell|reps:uni|Full Body|Traps
Kettlebell Snatch|power|kettlebell|reps:uni|Full Body|Shoulders
Kettlebell Clean|power|kettlebell|reps:uni|Full Body|Traps
Kettlebell Clean and Jerk|power|kettlebell|reps:uni|Full Body|Shoulders
Turkish Get-up|power|kettlebell|reps:uni|Core|Shoulders
Barbell Thruster|power|barbell|reps|Full Body|Quads,Shoulders
Dumbbell Thruster|power|dumbbell|reps|Full Body|Quads,Shoulders
Wall Ball|power|ball|reps|Full Body|Quads,Shoulders

# ---------------- plyometrics and jumps ----------------
Box Jump|plyo|bodyweight|reps:bw|Quads|Glutes,Calves
Depth Jump|plyo|bodyweight|reps:bw|Quads|Calves
Depth Drop|plyo|bodyweight|reps:bw|Quads|Calves
Broad Jump|plyo|bodyweight|reps:bw|Glutes|Quads
Vertical Jump|plyo|bodyweight|reps:bw|Quads|Calves
Squat Jump|plyo|bodyweight|reps:bw|Quads|Glutes
Tuck Jump|plyo|bodyweight|reps:bw|Quads|Core
Split Squat Jump|plyo|bodyweight|reps:bw:uni|Quads|Glutes
Lunge Jump|plyo|bodyweight|reps:bw:uni|Quads|Glutes
Single-leg Hop|plyo|bodyweight|reps:bw:uni|Calves|Quads
Lateral Bound|plyo|bodyweight|reps:bw:uni|Glutes|Abductors
Skater Jump|plyo|bodyweight|reps:bw:uni|Glutes|Quads
Pogo Hop|plyo|bodyweight|reps:bw|Calves|
Ankle Hop|plyo|bodyweight|reps:bw|Calves|
Hurdle Hop|plyo|bodyweight|reps:bw|Calves|Quads
Kneeling Jump|plyo|bodyweight|reps:bw|Glutes|Quads
Band-resisted Jump|plyo|band|reps:bw|Quads|Glutes
Clap Push-up|plyo|bodyweight|reps:bw|Chest|Triceps
Plyo Push-up|plyo|bodyweight|reps:bw|Chest|Shoulders
Medicine Ball Slam|plyo|ball|reps|Core|Lats
Medicine Ball Chest Pass|plyo|ball|reps|Chest|Triceps
Rotational Medicine Ball Throw|plyo|ball|reps:uni|Obliques|Core
Overhead Medicine Ball Throw|plyo|ball|reps|Shoulders|Core

# ---------------- strongman ----------------
Log Press|strength|none|reps|Shoulders|Triceps,Core
Log Clean and Press|strength|none|reps|Shoulders|Full Body
Axle Press|strength|barbell|reps|Shoulders|Triceps
Axle Deadlift|strength|barbell|reps|Hamstrings|Forearms,Back
Circus Dumbbell Press|strength|dumbbell|reps:uni|Shoulders|Core
Atlas Stone Lift|strength|none|reps|Glutes|Back,Biceps
Stone Over Bar|strength|none|reps|Glutes|Back
Sandbag Load|strength|none|reps|Glutes|Back,Core
Sandbag Clean|power|none|reps|Full Body|Back
Sandbag Over Shoulder|power|none|reps:uni|Full Body|Core
Keg Clean and Press|power|none|reps|Shoulders|Full Body
Tire Flip|power|none|reps|Glutes|Back,Chest
Car Deadlift|strength|none|reps|Hamstrings|Back
Frame Carry|carry|none|distance|Forearms|Traps
Keg Carry|carry|none|distance|Core|Forearms
Husafell Carry|carry|none|distance|Core|Back
Arm-over-arm Pull|strength|rope|reps|Lats|Forearms
Hercules Hold|isometric|none|time|Forearms|Traps
Crucifix Hold|isometric|dumbbell|time|Shoulders|Traps
Axle Hold|isometric|barbell|time|Forearms|Traps
Thick Bar Hold|isometric|barbell|time|Forearms|
Towel Hang|isometric|bodyweight|time:bw|Forearms|Lats

# ---------------- CrossFit and conditioning movements ----------------
Burpee|plyo|bodyweight|reps:bw|Full Body|Chest
Burpee Box Jump-over|plyo|bodyweight|reps:bw|Full Body|Quads
Burpee Pull-up|plyo|bodyweight|reps:bw|Full Body|Lats
Devil Press|power|dumbbell|reps|Full Body|Shoulders
Man Maker|power|dumbbell|reps|Full Body|Back
Squat Thrust|plyo|bodyweight|reps:bw|Quads|Core
Sit-out|core|bodyweight|reps:bw|Core|Shoulders
Wall Walk|strength|bodyweight|reps:bw|Shoulders|Core
Handstand Walk|strength|bodyweight|distance:bw|Shoulders|Core
Box Jump-over|plyo|bodyweight|reps:bw|Quads|Calves
Lateral Box Jump|plyo|bodyweight|reps:bw:uni|Glutes|Quads
Single-leg Box Jump|plyo|bodyweight|reps:bw:uni|Quads|Glutes
Seated Box Jump|plyo|bodyweight|reps:bw|Quads|Glutes
Bounding|plyo|bodyweight|reps:bw|Glutes|Calves
Sumo Deadlift High Pull|power|barbell|reps|Traps|Glutes
Ground to Overhead|power|barbell|reps|Full Body|Shoulders
Kipping Pull-up|strength|bodyweight|reps:bw|Lats|Core
Butterfly Pull-up|strength|bodyweight|reps:bw|Lats|Core
Chest-to-bar Pull-up|strength|bodyweight|reps:bw|Lats|Back
Toes-to-rings|core|ring|reps:bw|Core|Lats
Ring Muscle-up|power|ring|reps:bw|Lats|Chest,Triceps
Bar Muscle-up|power|bodyweight|reps:bw|Lats|Chest
Skin the Cat|strength|ring|reps:bw|Lats|Core
Front Lever Raise|strength|bodyweight|reps:bw|Lats|Core
One-arm Pull-up|strength|bodyweight|reps:bw:uni|Lats|Biceps
Human Flag|isometric|bodyweight|time:bw|Obliques|Shoulders
Shrimp Squat|strength|bodyweight|reps:bw:uni|Quads|Glutes
Flutter Kicks|core|bodyweight|reps:bw|Core|
Scissor Kicks|core|bodyweight|reps:bw|Core|
Heel Taps|core|bodyweight|reps:bw|Obliques|
Plank Walkout|core|bodyweight|reps:bw|Core|Shoulders
Side Plank with Rotation|core|bodyweight|reps:bw:uni|Obliques|Core
Suitcase Deadlift|strength|dumbbell|reps:uni|Obliques|Hamstrings

# ---------------- more cable and machine work ----------------
Cable Chest Press|strength|cable|reps|Chest|Triceps
Incline Cable Press|strength|cable|reps|Chest|Shoulders
Cable Crossover|strength|cable|reps|Chest|
Cable Squeeze Press|strength|cable|reps|Chest|
Cable Pullover|strength|cable|reps|Lats|Chest
Cable Front Raise|strength|cable|reps|Shoulders|
Cable Overhead Press|strength|cable|reps:uni|Shoulders|Triceps
Cable Reverse-grip Pushdown|strength|cable|reps|Triceps|
Cable Lying Extension|strength|cable|reps|Triceps|
Cable Cross-body Extension|strength|cable|reps:uni|Triceps|
High Cable Curl|strength|cable|reps|Biceps|
Cable Hammer Curl|strength|cable|reps|Biceps|Forearms
Cable Reverse Curl|strength|cable|reps|Forearms|Biceps
Cable Hip Abduction|strength|cable|reps:uni|Abductors|Glutes
Cable Hip Adduction|strength|cable|reps:uni|Adductors|
Cable Rotation|core|cable|reps:uni|Obliques|Core
Cable Reverse Woodchop|core|cable|reps:uni|Obliques|Core
Smith Machine Row|strength|smith|reps|Back|Lats
Smith Machine Split Squat|strength|smith|reps:uni|Quads|Glutes
Assisted Dip|strength|machine|reps|Chest|Triceps
Glute Kickback Machine|strength|machine|reps:uni|Glutes|Hamstrings
Hip Thrust Machine|strength|machine|reps|Glutes|Hamstrings
Preacher Curl Machine|strength|machine|reps|Biceps|
Seated Dip Machine|strength|machine|reps|Triceps|Chest
Swiss Ball Leg Curl|strength|ball|reps:bw|Hamstrings|Glutes
Slant Board Squat|strength|bodyweight|reps:bw|Quads|
Landmine Squat|strength|landmine|reps|Quads|Glutes
Cossack Squat|strength|bodyweight|reps:bw:uni|Adductors|Quads
Jefferson Deadlift|strength|barbell|reps|Quads|Glutes
Cross-body Hammer Curl|strength|dumbbell|reps:uni|Biceps|Forearms
Waiter Curl|strength|dumbbell|reps|Biceps|
Dumbbell Floor Press|strength|dumbbell|reps|Triceps|Chest
Kettlebell Floor Press|strength|kettlebell|reps:uni|Chest|Triceps
Neck Bridge|isometric|bodyweight|time:bw|Neck|
Lateral Neck Flexion|strength|none|reps:uni|Neck|

# ---------------- more Olympic partials ----------------
Snatch Balance|olympic|barbell|reps|Shoulders|Quads
Drop Snatch|olympic|barbell|reps|Shoulders|Quads
Tall Clean|olympic|barbell|reps|Traps|Shoulders
Tall Snatch|olympic|barbell|reps|Shoulders|Traps
Clean Deadlift|olympic|barbell|reps|Hamstrings|Back
Power Position Clean|olympic|barbell|reps|Traps|Quads
Sots Press|olympic|barbell|reps|Shoulders|Core
Behind-the-neck Push Press|olympic|barbell|reps|Shoulders|Triceps

# ---------------- more throws ----------------
Medicine Ball Scoop Toss|plyo|ball|reps|Glutes|Core
Backward Overhead Throw|plyo|ball|reps|Glutes|Shoulders
Drop Push-up|plyo|bodyweight|reps:bw|Chest|Triceps
Reactive Hop|plyo|bodyweight|reps:bw|Calves|
`;
