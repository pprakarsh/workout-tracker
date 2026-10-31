// The catalogue's CONDITIONING half: running, other cardio, mobility and prehab.
//
// Split from js/catalogdata.js (the gym half) so neither file fights the
// 1000-line cap. Same one-line format, documented there.
//
//   Name | category | equipment | measure[:flags] | primary | secondary,…
//
// Cardio uses `cardio` as its measure, which the app logs as duration + pace +
// distance rather than sets and reps. A sport session is in here too: an hour of
// football is conditioning you did, and a tracker that cannot record it quietly
// under-reports your week.
export const CONDITIONING_LINES = `
# ---------------- running ----------------
Easy Run|running|none|cardio|Full Body|
Long Run|running|none|cardio|Full Body|
Recovery Run|running|none|cardio|Full Body|
Progression Run|running|none|cardio|Full Body|
Tempo Run|running|none|cardio|Full Body|
Threshold Run|running|none|cardio|Full Body|
Marathon Pace Run|running|none|cardio|Full Body|
Interval Run|running|none|cardio|Full Body|
Cruise Intervals|running|none|cardio|Full Body|
Track Intervals|running|none|cardio|Full Body|
Fartlek Run|running|none|cardio|Full Body|
Hill Repeats|running|none|cardio|Full Body|
Hill Sprints|running|none|cardio|Full Body|
Downhill Run|running|none|cardio|Full Body|
Strides|running|none|cardio|Full Body|
Sprint|running|none|cardio|Full Body|
Sprint Intervals|running|none|cardio|Full Body|
Flying Sprint|running|none|cardio|Full Body|
Sprint Start|running|none|cardio|Full Body|
Shuttle Run|running|none|cardio|Full Body|
Beep Test|running|none|cardio|Full Body|
Time Trial|running|none|cardio|Full Body|
Race|running|none|cardio|Full Body|
Parkrun|running|none|cardio|Full Body|
Sled Sprint|running|sled|cardio|Quads|
Resisted Sprint|running|band|cardio|Quads|
Treadmill Run|running|machine|cardio|Full Body|
Treadmill Intervals|running|machine|cardio|Full Body|
Trail Run|running|none|cardio|Full Body|
Cross Country Run|running|none|cardio|Full Body|
Brick Run|running|none|cardio|Full Body|
Walk|running|none|cardio|Full Body|
Brisk Walk|running|none|cardio|Full Body|
Incline Walk|running|machine|cardio|Calves|
Treadmill Walk|running|machine|cardio|Full Body|
Hike|running|none|cardio|Full Body|
Ruck|running|none|cardio|Full Body|
Weighted Hike|running|none|cardio|Full Body|
Stair Run|running|none|cardio|Quads|
Track Walk|running|none|cardio|Full Body|

# ---------------- machine and water cardio ----------------
Cycling|cardio|none|cardio|Quads|
Road Cycling|cardio|none|cardio|Quads|
Mountain Biking|cardio|none|cardio|Quads|
Stationary Bike|cardio|machine|cardio|Quads|
Spin Class|cardio|machine|cardio|Quads|
Bike Intervals|cardio|machine|cardio|Quads|
Assault Bike|cardio|machine|cardio|Full Body|
Recumbent Bike|cardio|machine|cardio|Quads|
Rowing Machine|cardio|machine|cardio|Full Body|
Rowing Intervals|cardio|machine|cardio|Full Body|
Rowing|cardio|none|cardio|Full Body|
Kayaking|cardio|none|cardio|Full Body|
Canoeing|cardio|none|cardio|Full Body|
Stand-up Paddleboarding|cardio|none|cardio|Core|
SkiErg|cardio|machine|cardio|Full Body|
Stair Climber|cardio|machine|cardio|Glutes|
Stairs|cardio|none|cardio|Quads|
Elliptical|cardio|machine|cardio|Full Body|
Arc Trainer|cardio|machine|cardio|Quads|
Versaclimber|cardio|machine|cardio|Full Body|
Swimming|cardio|none|cardio|Full Body|
Freestyle Swim|cardio|none|cardio|Full Body|
Backstroke|cardio|none|cardio|Full Body|
Breaststroke|cardio|none|cardio|Full Body|
Butterfly Swim|cardio|none|cardio|Full Body|
Swim Kick Set|cardio|none|cardio|Quads|
Swim Pull Set|cardio|none|cardio|Lats|
Open Water Swim|cardio|none|cardio|Full Body|
Aqua Jogging|cardio|none|cardio|Full Body|
Jump Rope|cardio|rope|cardio|Calves|
Jump Rope Intervals|cardio|rope|cardio|Calves|
Double-unders|cardio|rope|cardio|Calves|
Battle Ropes|cardio|rope|cardio|Shoulders|
Shadow Boxing|cardio|none|cardio|Full Body|
Boxing|cardio|none|cardio|Full Body|
Heavy Bag Work|cardio|none|cardio|Shoulders|
Pad Work|cardio|none|cardio|Shoulders|
Muay Thai|cardio|none|cardio|Full Body|
Kickboxing|cardio|none|cardio|Full Body|
Brazilian Jiu-Jitsu|cardio|none|cardio|Full Body|
Wrestling|cardio|none|cardio|Full Body|
Judo|cardio|none|cardio|Full Body|
Karate|cardio|none|cardio|Full Body|
Taekwondo|cardio|none|cardio|Full Body|
Fencing|cardio|none|cardio|Full Body|
Nordic Skiing|cardio|none|cardio|Full Body|
Downhill Skiing|cardio|none|cardio|Quads|
Snowboarding|cardio|none|cardio|Quads|
Ice Skating|cardio|none|cardio|Quads|
Inline Skating|cardio|none|cardio|Quads|
Surfing|cardio|none|cardio|Full Body|
Climbing|cardio|none|cardio|Lats|Forearms
Bouldering|cardio|none|cardio|Lats|Forearms
Football|cardio|none|cardio|Full Body|
Basketball|cardio|none|cardio|Full Body|
Tennis|cardio|none|cardio|Full Body|
Padel|cardio|none|cardio|Full Body|
Squash|cardio|none|cardio|Full Body|
Badminton|cardio|none|cardio|Full Body|
Pickleball|cardio|none|cardio|Full Body|
Table Tennis|cardio|none|cardio|Full Body|
Volleyball|cardio|none|cardio|Full Body|
Handball|cardio|none|cardio|Full Body|
Hockey|cardio|none|cardio|Full Body|
Field Hockey|cardio|none|cardio|Full Body|
Rugby|cardio|none|cardio|Full Body|
Cricket|cardio|none|cardio|Full Body|
Baseball|cardio|none|cardio|Full Body|
Golf|cardio|none|cardio|Full Body|
Dance|cardio|none|cardio|Full Body|
Zumba|cardio|none|cardio|Full Body|
Aerobics|cardio|none|cardio|Full Body|
Step Aerobics|cardio|none|cardio|Quads|
HIIT Circuit|cardio|none|cardio|Full Body|
Tabata|cardio|none|cardio|Full Body|
Circuit Training|cardio|none|cardio|Full Body|
Metcon|cardio|none|cardio|Full Body|
Sled Conditioning|cardio|sled|cardio|Quads|
Farmer Carry Conditioning|cardio|dumbbell|cardio|Forearms|
Triathlon|cardio|none|cardio|Full Body|
Duathlon|cardio|none|cardio|Full Body|

# ---------------- mobility: hips and legs ----------------
World's Greatest Stretch|mobility|bodyweight|time:bw:uni|Quads|Core
Hip Flexor Stretch|mobility|bodyweight|time:bw:uni|Quads|
Couch Stretch|mobility|bodyweight|time:bw:uni|Quads|
Low Lunge|mobility|bodyweight|time:bw:uni|Quads|
Lizard Pose|mobility|bodyweight|time:bw:uni|Quads|Adductors
Pigeon Pose|mobility|bodyweight|time:bw:uni|Glutes|
Half Pigeon|mobility|bodyweight|time:bw:uni|Glutes|
Standing Pigeon|mobility|bodyweight|time:bw:uni|Glutes|
90/90 Hip Stretch|mobility|bodyweight|time:bw:uni|Glutes|
Shin Box Switch|mobility|bodyweight|reps:bw|Glutes|Core
Hip Airplane|mobility|bodyweight|reps:bw:uni|Glutes|Core
Figure-4 Stretch|mobility|bodyweight|time:bw:uni|Glutes|
Hamstring Stretch|mobility|bodyweight|time:bw:uni|Hamstrings|
Seated Forward Fold|mobility|bodyweight|time:bw|Hamstrings|Lower Back
Standing Forward Fold|mobility|bodyweight|time:bw|Hamstrings|
Wide-legged Forward Fold|mobility|bodyweight|time:bw|Adductors|Hamstrings
Seated Pike Stretch|mobility|bodyweight|time:bw|Hamstrings|
Pancake Stretch|mobility|bodyweight|time:bw|Adductors|Hamstrings
Straddle Stretch|mobility|bodyweight|time:bw|Adductors|
Butterfly Stretch|mobility|bodyweight|time:bw|Adductors|
Frog Stretch|mobility|bodyweight|time:bw|Adductors|
Adductor Rock Back|mobility|bodyweight|time:bw|Adductors|
Garland Pose|mobility|bodyweight|time:bw|Adductors|Quads
Deep Squat Hold|mobility|bodyweight|time:bw|Adductors|Quads
Cossack Stretch|mobility|bodyweight|time:bw:uni|Adductors|
Quad Stretch|mobility|bodyweight|time:bw:uni|Quads|
Standing Quad Stretch|mobility|bodyweight|time:bw:uni|Quads|
Calf Stretch|mobility|bodyweight|time:bw:uni|Calves|
Ankle Dorsiflexion Stretch|mobility|bodyweight|time:bw:uni|Calves|
Knee-to-wall Ankle Rock|mobility|bodyweight|reps:bw:uni|Calves|
Toe Yoga|mobility|bodyweight|reps:bw|Calves|
Happy Baby|mobility|bodyweight|time:bw|Adductors|
Supine Twist|mobility|bodyweight|time:bw:uni|Lower Back|Obliques
Scorpion Stretch|mobility|bodyweight|time:bw:uni|Lower Back|Quads
Bretzel Stretch|mobility|bodyweight|time:bw:uni|Quads|Back

# ---------------- mobility: spine, shoulders and arms ----------------
Cat-Cow|mobility|bodyweight|reps:bw|Lower Back|Core
Child's Pose|mobility|bodyweight|time:bw|Lats|Lower Back
Puppy Pose|mobility|bodyweight|time:bw|Lats|Shoulders
Downward Dog|mobility|bodyweight|time:bw|Hamstrings|Shoulders
Dolphin Pose|mobility|bodyweight|time:bw|Shoulders|Hamstrings
Cobra Stretch|mobility|bodyweight|time:bw|Core|Lower Back
Sphinx Pose|mobility|bodyweight|time:bw|Lower Back|Core
Prone Press-up|mobility|bodyweight|reps:bw|Lower Back|
Camel Pose|mobility|bodyweight|time:bw|Core|Quads
Bow Pose|mobility|bodyweight|time:bw|Core|Quads
Bridge Pose|mobility|bodyweight|time:bw|Glutes|Core
Fish Pose|mobility|bodyweight|time:bw|Chest|Neck
Locust Pose|mobility|bodyweight|time:bw|Lower Back|Glutes
Plough Pose|mobility|bodyweight|time:bw|Back|Hamstrings
Shoulder Stand|mobility|bodyweight|time:bw|Shoulders|Core
Thread the Needle|mobility|bodyweight|time:bw:uni|Back|Shoulders
Open Book Rotation|mobility|bodyweight|reps:bw:uni|Back|Obliques
Seated Spinal Twist|mobility|bodyweight|time:bw:uni|Obliques|Lower Back
Revolved Triangle|mobility|bodyweight|time:bw:uni|Hamstrings|Obliques
Thoracic Extension over Foam Roller|mobility|none|time:bw|Back|
Lat Stretch|mobility|bodyweight|time:bw:uni|Lats|
Cow Face Arms|mobility|bodyweight|time:bw:uni|Shoulders|Triceps
Doorway Chest Stretch|mobility|bodyweight|time:bw|Chest|Shoulders
Sleeper Stretch|mobility|bodyweight|time:bw:uni|Shoulders|
Cross-body Shoulder Stretch|mobility|bodyweight|time:bw:uni|Shoulders|
Triceps Stretch|mobility|bodyweight|time:bw:uni|Triceps|
Shoulder Dislocates|mobility|band|reps:bw|Shoulders|Chest
Wall Slide|mobility|bodyweight|reps:bw|Shoulders|Traps
Wall Angel|mobility|bodyweight|reps:bw|Shoulders|Traps
Banded Shoulder Distraction|mobility|band|time:uni|Shoulders|
Banded Hip Distraction|mobility|band|time:uni|Glutes|
Wrist Flexor Stretch|mobility|bodyweight|time:bw|Forearms|
Wrist Extensor Stretch|mobility|bodyweight|time:bw|Forearms|
Wrist Circles|mobility|bodyweight|reps:bw|Forearms|
Neck Side Flexion Stretch|mobility|bodyweight|time:bw:uni|Neck|
Levator Scapulae Stretch|mobility|bodyweight|time:bw:uni|Neck|Traps
Chin Tuck|rehab|bodyweight|reps:bw|Neck|

# ---------------- mobility: standing yoga and balance ----------------
Mountain Pose|mobility|bodyweight|time:bw|Core|
Tree Pose|mobility|bodyweight|time:bw:uni|Calves|Core
Warrior I|mobility|bodyweight|time:bw:uni|Quads|Shoulders
Warrior II|mobility|bodyweight|time:bw:uni|Quads|Shoulders
Warrior III|mobility|bodyweight|time:bw:uni|Glutes|Core
Triangle Pose|mobility|bodyweight|time:bw:uni|Hamstrings|Obliques
Extended Side Angle|mobility|bodyweight|time:bw:uni|Quads|Obliques
Half Moon Pose|mobility|bodyweight|time:bw:uni|Hamstrings|Core
Eagle Pose|mobility|bodyweight|time:bw:uni|Shoulders|Quads
Dancer Pose|mobility|bodyweight|time:bw:uni|Quads|Core
Boat Pose|mobility|bodyweight|time:bw|Core|Quads
Sun Salutation|mobility|bodyweight|reps:bw|Full Body|
Vinyasa Flow|mobility|bodyweight|time:bw|Full Body|
Yin Yoga|mobility|bodyweight|time:bw|Full Body|
Pilates Mat|mobility|bodyweight|time:bw|Core|

# ---------------- mobility: drills and warm-ups ----------------
Hip CARs|mobility|bodyweight|reps:bw:uni|Glutes|
Shoulder CARs|mobility|bodyweight|reps:bw:uni|Shoulders|
Neck CARs|mobility|bodyweight|reps:bw|Neck|
Scapular CARs|mobility|bodyweight|reps:bw|Traps|
Leg Swings|mobility|bodyweight|reps:bw:uni|Hamstrings|Glutes
Lateral Leg Swings|mobility|bodyweight|reps:bw:uni|Adductors|Abductors
Arm Circles|mobility|bodyweight|reps:bw|Shoulders|
Hip Circles|mobility|bodyweight|reps:bw|Glutes|
Ankle Circles|mobility|bodyweight|reps:bw:uni|Calves|
Inchworm|mobility|bodyweight|reps:bw|Hamstrings|Core
Walking Knee Hug|mobility|bodyweight|reps:bw:uni|Glutes|
Walking Quad Pull|mobility|bodyweight|reps:bw:uni|Quads|
Walking Toe Touch|mobility|bodyweight|reps:bw:uni|Hamstrings|
A-skip|mobility|bodyweight|reps:bw|Calves|Quads
B-skip|mobility|bodyweight|reps:bw|Hamstrings|Calves
High Knees|mobility|bodyweight|reps:bw|Quads|Core
Butt Kicks|mobility|bodyweight|reps:bw|Hamstrings|
Carioca|mobility|bodyweight|reps:bw|Adductors|Core
Lateral Shuffle|mobility|bodyweight|reps:bw|Abductors|Quads
Jumping Jacks|mobility|bodyweight|reps:bw|Shoulders|Calves
Seal Jacks|mobility|bodyweight|reps:bw|Chest|Shoulders
Foam Roll Quads|mobility|none|time:bw|Quads|
Foam Roll IT Band|mobility|none|time:bw:uni|Abductors|
Foam Roll Glutes|mobility|none|time:bw|Glutes|
Foam Roll Hamstrings|mobility|none|time:bw|Hamstrings|
Foam Roll Lats|mobility|none|time:bw|Lats|
Foam Roll Calves|mobility|none|time:bw|Calves|
Foam Roll Thoracic Spine|mobility|none|time:bw|Back|
Lacrosse Ball Release|mobility|none|time:bw|Glutes|
Plantar Fascia Release|mobility|none|time:bw:uni|Calves|

# ---------------- prehab and rehab ----------------
External Rotation|rehab|band|reps:uni|Shoulders|
Internal Rotation|rehab|band|reps:uni|Shoulders|
Sidelying External Rotation|rehab|dumbbell|reps:uni|Shoulders|
Full Can Raise|rehab|dumbbell|reps:uni|Shoulders|
Empty Can Raise|rehab|dumbbell|reps:uni|Shoulders|
Band Pull-apart|rehab|band|reps|Rear Delts|Traps
Prone Horizontal Abduction|rehab|dumbbell|reps|Rear Delts|Traps
Prone Y Raise|rehab|dumbbell|reps|Traps|Rear Delts
Prone T Raise|rehab|dumbbell|reps|Traps|Rear Delts
Prone W Raise|rehab|dumbbell|reps|Traps|Rear Delts
Prone L Raise|rehab|dumbbell|reps:uni|Shoulders|Rear Delts
Y Raise|rehab|dumbbell|reps|Shoulders|Traps
Cuban Press|rehab|dumbbell|reps|Shoulders|Rear Delts
Scapular Pull-up|rehab|bodyweight|reps:bw|Lats|Traps
Scapular Push-up|rehab|bodyweight|reps:bw|Traps|Shoulders
Serratus Wall Slide|rehab|bodyweight|time:bw|Shoulders|
Tyler Twist|rehab|band|reps:uni|Forearms|
Wrist Rotation|rehab|dumbbell|reps|Forearms|
Finger Extension|rehab|band|reps|Forearms|
Nerve Glide|rehab|bodyweight|reps:bw:uni|Forearms|
McGill Curl-up|rehab|bodyweight|time:bw|Core|
Stir the Pot|rehab|ball|time:bw|Core|
Clamshell|rehab|band|reps:uni|Glutes|Abductors
Fire Hydrant|rehab|bodyweight|reps:bw:uni|Glutes|Abductors
Side-lying Hip Abduction|rehab|bodyweight|reps:bw:uni|Abductors|Glutes
Standing Hip Abduction|rehab|band|reps:uni|Abductors|Glutes
Hip Hike|rehab|bodyweight|reps:bw:uni|Abductors|
Lateral Band Walk|rehab|band|reps|Abductors|Glutes
Monster Walk|rehab|band|reps|Glutes|Abductors
Copenhagen Adduction|rehab|bodyweight|reps:bw:uni|Adductors|Core
Terminal Knee Extension|rehab|band|reps:uni|Quads|
Peterson Step-up|rehab|bodyweight|reps:bw:uni|Quads|
Patrick Step|rehab|bodyweight|reps:bw:uni|Quads|
Single-leg Squat to Box|rehab|bodyweight|reps:bw:uni|Quads|Glutes
Tibialis Raise|rehab|bodyweight|reps:bw|Calves|
Heel Raise|rehab|bodyweight|reps:bw:uni|Calves|
Eccentric Heel Drop|rehab|bodyweight|reps:bw:uni|Calves|
Short Foot Exercise|rehab|bodyweight|reps:bw:uni|Calves|
`;
