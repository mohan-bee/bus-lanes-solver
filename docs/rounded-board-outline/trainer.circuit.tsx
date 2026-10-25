// Passive length-matching trainer.
// J1 and J2: pins 1-8 = D0-D7, pin 9 = CLK, pin 10 = GND.
// Bus target is connector-to-connector; equal 3 mm probe branches are separate.
// Keep bus signals as direct traces: a 3-terminal net cannot use bus_lanes.
const signals = ["D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "CLK"]
const pinLabels = [...signals, "GND"]
const pinY = (index: number) => 11.43 - index * 2.54

export default function LengthMatchingPracticeBoard() {
  return (
    <board
      width="64mm"
      height="40mm"
      borderRadius="2mm"
      layers={2}
      thickness="1.6mm"
      title="8-bit bus + clock length-matching trainer"
      schLayout={{ layoutMode: "relative" }}
      schTraceAutoLabelEnabled
      schMaxTraceDistance="5mm"
      defaultTraceWidth="0.2mm"
      minTraceWidth="0.2mm"
      minTraceToPadEdgeClearance="0.2mm"
      solderMaskColor="blue"
    >
      <schematicsheet name="trainer" displayName="Length-matching trainer">
        <schematicsection name="source" displayName="J1 / Signal input" />
        <schematicsection name="receiver" displayName="J2 / Signal output" />
        <schematicsection
          name="probes"
          displayName="Probe access / D0-D7, CLK, GND"
        />

        <pinheader
          name="J1"
          pinCount={10}
          pitch="2.54mm"
          gender="male"
          pinLabels={pinLabels}
          holeDiameter="1mm"
          platedDiameter="1.7mm"
          pcbX={-24}
          pcbY={0}
          pcbRotation={-90}
          schX={-10}
          schWidth={0.48}
          schY={3}
          schFacingDirection="right"
          schSectionName="source"
        />
        <pinheader
          name="J2"
          pinCount={10}
          pitch="2.54mm"
          gender="male"
          pinLabels={pinLabels}
          holeDiameter="1mm"
          platedDiameter="1.7mm"
          pcbX={24}
          pcbY={0}
          pcbRotation={-90}
          schX={10}
          schWidth={0.48}
          schY={3}
          schFacingDirection="left"
          schSectionName="receiver"
        />

        {/* Phase 0: match all nine point-to-point signal routes together. */}
        <autoroutingphase
          name="MATCHED_DATA_AND_CLOCK"
          phaseIndex={0}
          autorouter="bus_lanes"
        />
        <bus
          name="DATA_AND_CLOCK"
          connections={signals}
          routingPhaseIndex={0}
          targetLength="50mm"
          lengthTolerance="0.5mm"
          maxLengthSkew="0.1mm"
          pcbTraceWidth="0.2mm"
          pcbAllowedLayers={["top"]}
        />
        {signals.map((signal, index) => (
          <trace
            key={signal}
            name={signal}
            from={`J1.pin${index + 1}`}
            to={`J2.pin${index + 1}`}
            routingPhaseIndex={0}
            width="0.2mm"
          />
        ))}

        {/* Phase 1 preserves the matched copper and adds short probe branches. */}
        <autoroutingphase name="PROBES_AND_GROUND" phaseIndex={1} />
        {signals.map((signal, index) => (
          <testpoint
            key={signal}
            name={`TP_${signal}`}
            footprintVariant="pad"
            doNotPlace
            padShape="circle"
            padDiameter="1.2mm"
            layer="top"
            pcbX={27}
            pcbY={pinY(index)}
            schX={-8 + (index % 5) * 4}
            schY={-6 - Math.floor(index / 5) * 3}
            schSectionName="probes"
          />
        ))}
        {signals.map((signal, index) => (
          <trace
            key={`probe_${signal}`}
            name={`PROBE_${signal}`}
            from={`J2.pin${index + 1}`}
            to={`TP_${signal}.pin1`}
            routingPhaseIndex={1}
            width="0.2mm"
          />
        ))}

        <net name="GND" routingPhaseIndex={1} />
        <testpoint
          name="TP_GND"
          footprintVariant="pad"
          doNotPlace
          padShape="circle"
          padDiameter="1.2mm"
          pcbX={27}
          pcbY={pinY(9)}
          schX={8}
          schY={-9}
          schSectionName="probes"
        />
        <trace
          from="J1.pin10"
          to="net.GND"
          routingPhaseIndex={1}
          width="0.4mm"
        />
        <trace
          from="J2.pin10"
          to="net.GND"
          routingPhaseIndex={1}
          width="0.4mm"
        />
        <trace
          from="TP_GND.pin1"
          to="net.GND"
          routingPhaseIndex={1}
          width="0.4mm"
        />
        <copperpour
          connectsTo="net.GND"
          layer="bottom"
          clearance="0.25mm"
          boardEdgeMargin="0.5mm"
          useThermalReliefs
        />

        {[
          [-28, 16],
          [28, 16],
          [-28, -16],
          [28, -16],
        ].map(([x, y], i) => (
          <hole key={i} diameter="3.2mm" pcbX={x} pcbY={y} />
        ))}

        <silkscreentext
          text="LENGTH MATCH / 8 + CLK"
          pcbX={0}
          pcbY={17}
          fontSize="1.3mm"
        />
        <silkscreentext text="J1 / IN" pcbX={-23} pcbY={14} fontSize="0.9mm" />
        <silkscreentext text="J2 / OUT" pcbX={23} pcbY={14} fontSize="0.9mm" />
        {pinLabels.map((label, index) => (
          <silkscreentext
            key={`in_${label}`}
            text={label}
            pcbX={-20.5}
            pcbY={pinY(index)}
            fontSize="0.8mm"
          />
        ))}
        {pinLabels.map((label, index) => (
          <silkscreentext
            key={`tp_${label}`}
            text={label}
            pcbX={29.5}
            pcbY={pinY(index)}
            fontSize="0.75mm"
          />
        ))}
        <silkscreentext
          text="BUS TARGET 50 mm / SKEW <= 0.10 mm"
          pcbX={0}
          pcbY={-15.5}
          fontSize="0.8mm"
        />
        <silkscreentext
          text="PASSIVE TRAINER / EXTERNAL CLOCK"
          pcbX={0}
          pcbY={-18}
          fontSize="0.8mm"
        />
      </schematicsheet>
    </board>
  )
}
