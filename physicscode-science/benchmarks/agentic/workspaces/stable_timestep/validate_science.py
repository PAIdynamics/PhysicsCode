from candidate import stable_timestep


dx = 2.0
wave_speed = 4.0
dt = stable_timestep(dx, wave_speed, cfl=0.5)

assert dt > 0.0
assert dt <= dx / wave_speed

