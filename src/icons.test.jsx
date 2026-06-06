import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon, ICON_PATHS } from "./icons.jsx";

describe("Icon", () => {
  it("renders an svg with the named path", () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.querySelector("path").getAttribute("d")).toBe("M20 6 9 17l-5-5");
  });
  it("honors size, stroke, className and style", () => {
    const { container } = render(
      <Icon name="x" size={20} stroke={3} className="foo" style={{ color: "red" }} />,
    );
    const svg = container.querySelector("svg");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("stroke-width")).toBe("3");
    expect(svg).toHaveClass("foo");
    expect(svg).toHaveStyle({ color: "rgb(255, 0, 0)" });
  });
  it("renders empty for an unknown icon name", () => {
    const { container } = render(<Icon name="does-not-exist" />);
    expect(container.querySelector("svg").innerHTML).toBe("");
  });
  it("has a populated icon set", () => {
    expect(Object.keys(ICON_PATHS).length).toBeGreaterThan(20);
  });
});
