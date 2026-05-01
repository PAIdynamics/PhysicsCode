import type { ComponentProps } from "solid-js"
import logoCircular from "../assets/logo-circular.png"

type LogoImageProps = Pick<ComponentProps<"img">, "ref" | "class">

const LogoImage = (props: LogoImageProps & { component: string }) => {
  return (
    <img
      ref={props.ref}
      data-component={props.component}
      class={props.class}
      src={logoCircular}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}

export const Mark = (props: { class?: string }) => {
  return <LogoImage component="logo-mark" class={props.class} />
}

export const Splash = (props: LogoImageProps) => {
  return <LogoImage component="logo-splash" ref={props.ref} class={props.class} />
}

export const Logo = (props: { class?: string }) => {
  return <LogoImage component="logo" class={props.class} />
}
