declare module '@mui/system' {
  export type ResponsiveStyleValue<T> = T | Array<T | null> | { [key: string]: T | null }
  export type SxProps<_Theme extends object = object> = _Theme | unknown
  export type SystemProps<_Theme extends object = object> = Record<string, unknown> & { theme?: _Theme }
}
