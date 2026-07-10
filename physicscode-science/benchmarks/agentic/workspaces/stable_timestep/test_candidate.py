from candidate import stable_timestep


assert stable_timestep(2.0, 4.0) == 0.25

for args in ((0.0, 1.0), (1.0, 0.0), (1.0, 1.0, 1.5)):
    try:
        stable_timestep(*args)
    except ValueError:
        continue
    raise AssertionError(f"expected ValueError for {args}")

