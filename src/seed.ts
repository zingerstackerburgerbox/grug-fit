import type { Exercise } from './types';
const raw: [string, string, string][] = [
  // Chest
  ['Bench Press (Barbell)', 'Chest', 'Barbell'], ['Incline Bench Press (Barbell)', 'Chest', 'Barbell'], ['Decline Bench Press (Barbell)', 'Chest', 'Barbell'],
  ['Bench Press (Dumbbell)', 'Chest', 'Dumbbell'], ['Incline Bench Press (Dumbbell)', 'Chest', 'Dumbbell'], ['Chest Fly (Dumbbell)', 'Chest', 'Dumbbell'],
  ['Cable Fly Crossovers', 'Chest', 'Cable'], ['Chest Press (Machine)', 'Chest', 'Machine'], ['Pec Deck (Machine)', 'Chest', 'Machine'],
  ['Push Up', 'Chest', 'Bodyweight'], ['Chest Dip', 'Chest', 'Bodyweight'],
  // Back
  ['Deadlift (Barbell)', 'Back', 'Barbell'], ['Bent Over Row (Barbell)', 'Back', 'Barbell'], ['Pendlay Row (Barbell)', 'Back', 'Barbell'],
  ['T-Bar Row', 'Back', 'Barbell'], ['Dumbbell Row', 'Back', 'Dumbbell'], ['Pull Up', 'Back', 'Bodyweight'], ['Chin Up', 'Back', 'Bodyweight'],
  ['Lat Pulldown (Cable)', 'Back', 'Cable'], ['Seated Cable Row', 'Back', 'Cable'], ['Straight Arm Pulldown', 'Back', 'Cable'],
  ['Seated Row (Machine)', 'Back', 'Machine'], ['Back Extension', 'Back', 'Bodyweight'], ['Rack Pull', 'Back', 'Barbell'],
  // Shoulders
  ['Overhead Press (Barbell)', 'Shoulders', 'Barbell'], ['Shoulder Press (Dumbbell)', 'Shoulders', 'Dumbbell'], ['Arnold Press (Dumbbell)', 'Shoulders', 'Dumbbell'],
  ['Lateral Raise (Dumbbell)', 'Shoulders', 'Dumbbell'], ['Lateral Raise (Cable)', 'Shoulders', 'Cable'], ['Front Raise (Dumbbell)', 'Shoulders', 'Dumbbell'],
  ['Rear Delt Fly (Dumbbell)', 'Shoulders', 'Dumbbell'], ['Reverse Pec Deck (Machine)', 'Shoulders', 'Machine'], ['Face Pull (Cable)', 'Shoulders', 'Cable'],
  ['Shoulder Press (Machine)', 'Shoulders', 'Machine'], ['Upright Row (Barbell)', 'Shoulders', 'Barbell'], ['Shrug (Dumbbell)', 'Traps', 'Dumbbell'], ['Shrug (Barbell)', 'Traps', 'Barbell'],
  // Arms
  ['Bicep Curl (Barbell)', 'Biceps', 'Barbell'], ['Bicep Curl (Dumbbell)', 'Biceps', 'Dumbbell'], ['Hammer Curl (Dumbbell)', 'Biceps', 'Dumbbell'],
  ['Preacher Curl (EZ Bar)', 'Biceps', 'Barbell'], ['Incline Curl (Dumbbell)', 'Biceps', 'Dumbbell'], ['Bicep Curl (Cable)', 'Biceps', 'Cable'], ['Concentration Curl', 'Biceps', 'Dumbbell'],
  ['Triceps Pushdown (Cable)', 'Triceps', 'Cable'], ['Overhead Triceps Extension (Cable)', 'Triceps', 'Cable'], ['Skullcrusher (EZ Bar)', 'Triceps', 'Barbell'],
  ['Close Grip Bench Press', 'Triceps', 'Barbell'], ['Triceps Dip', 'Triceps', 'Bodyweight'], ['Overhead Triceps Extension (Dumbbell)', 'Triceps', 'Dumbbell'],
  ['Wrist Curl (Barbell)', 'Forearms', 'Barbell'],
  // Legs
  ['Squat (Barbell)', 'Quadriceps', 'Barbell'], ['Front Squat (Barbell)', 'Quadriceps', 'Barbell'], ['Leg Press (Machine)', 'Quadriceps', 'Machine'],
  ['Hack Squat (Machine)', 'Quadriceps', 'Machine'], ['Leg Extension (Machine)', 'Quadriceps', 'Machine'], ['Bulgarian Split Squat (Dumbbell)', 'Quadriceps', 'Dumbbell'],
  ['Walking Lunge (Dumbbell)', 'Quadriceps', 'Dumbbell'], ['Goblet Squat (Dumbbell)', 'Quadriceps', 'Dumbbell'], ['Step Up (Dumbbell)', 'Quadriceps', 'Dumbbell'],
  ['Romanian Deadlift (Barbell)', 'Hamstrings', 'Barbell'], ['Romanian Deadlift (Dumbbell)', 'Hamstrings', 'Dumbbell'], ['Lying Leg Curl (Machine)', 'Hamstrings', 'Machine'],
  ['Seated Leg Curl (Machine)', 'Hamstrings', 'Machine'], ['Good Morning (Barbell)', 'Hamstrings', 'Barbell'], ['Hip Thrust (Barbell)', 'Glutes', 'Barbell'],
  ['Glute Bridge', 'Glutes', 'Bodyweight'], ['Hip Abduction (Machine)', 'Glutes', 'Machine'], ['Cable Kickback', 'Glutes', 'Cable'], ['Sumo Deadlift (Barbell)', 'Glutes', 'Barbell'],
  ['Standing Calf Raise (Machine)', 'Calves', 'Machine'], ['Seated Calf Raise (Machine)', 'Calves', 'Machine'], ['Calf Raise (Bodyweight)', 'Calves', 'Bodyweight'],
  // Core
  ['Plank', 'Core', 'Bodyweight'], ['Crunch', 'Core', 'Bodyweight'], ['Hanging Leg Raise', 'Core', 'Bodyweight'], ['Cable Crunch', 'Core', 'Cable'],
  ['Russian Twist', 'Core', 'Bodyweight'], ['Ab Wheel Rollout', 'Core', 'Other'], ['Pallof Press (Cable)', 'Core', 'Cable'],
  // Full body / other
  ['Kettlebell Swing', 'Full Body', 'Kettlebell'], ['Power Clean (Barbell)', 'Full Body', 'Barbell'], ['Farmer\'s Walk (Dumbbell)', 'Full Body', 'Dumbbell'],
  ['Burpee', 'Full Body', 'Bodyweight'], ['Thruster (Barbell)', 'Full Body', 'Barbell'],
  // Added later: ALWAYS append (ids are positional) and list the new ids in SEED_ADDED for the install migration.
  ['Reverse Cable Crunch', 'Core', 'Cable'] // ex086, v1.4.1 (v1.4.2: changed from a lying to the kneeling, back-to-the-stack movement)
];
/** How-to text for built-ins (shown on the exercise screen). Changing one needs a migration that refreshes `how` on existing installs. */
export const HOW: Record<string, string> = {
  'Reverse Cable Crunch': 'Set a rope on a high pulley. Kneel with your back to the stack, holding the rope ends beside your ears so the cable runs down over the back of your head. Keep your hips still and crunch forward and down, curling your spine to bring your elbows toward your thighs. Squeeze your abs, then return slowly to upright kneeling.'
};
export const SEED_EXERCISES: Exercise[] = raw.map(([name, muscle, equipment], i) => ({ id: 'ex' + String(i + 1).padStart(3, '0'), name, muscle, equipment, ...(HOW[name] ? { how: HOW[name] } : {}) }));
/** Built-ins added after the first release, keyed by the schema version whose migration adds them to existing installs. */
export const SEED_ADDED: Record<number, string[]> = { 3: ['ex086'] };
/** Built-ins whose definition (how-to text) changed, keyed by the schema version whose migration refreshes them. */
export const SEED_REFRESH: Record<number, string[]> = { 4: ['ex086'] };
export const MUSCLES = ['Chest', 'Back', 'Shoulders', 'Traps', 'Biceps', 'Triceps', 'Forearms', 'Quadriceps', 'Hamstrings', 'Glutes', 'Calves', 'Core', 'Full Body', 'Cardio', 'Other'];
export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Bodyweight', 'Kettlebell', 'Band', 'Other'];
