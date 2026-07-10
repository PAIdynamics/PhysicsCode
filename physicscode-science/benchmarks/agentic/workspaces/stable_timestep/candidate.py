def stable_timestep(dx: float, wave_speed: float, cfl: float = 0.5) -> float:
    if dx <= 0:
        raise ValueError("dx must be positive")
    if wave_speed <= 0:
        raise ValueError("wave_speed must be positive")
    if not 0 < cfl <= 1:
        raise ValueError("cfl must be in (0, 1]")
    return cfl * dx / wave_speed

