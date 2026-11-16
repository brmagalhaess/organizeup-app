// O Metro entrega imagem importada como o número do recurso.
declare module "*.png" {
  const source: import("react-native").ImageSourcePropType;
  export default source;
}
