import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import { useMemo } from 'react';

export type SeriesPoint = { t: number; value: number };

export const PnlChart = ({ points }: { points: SeriesPoint[] }) => {
  const options = useMemo(() => {
    return {
      chart: {
        type: 'areaspline',
        backgroundColor: 'transparent',
        height: 220,
        spacing: [10, 10, 10, 10]
      },
      title: { text: undefined },
      credits: { enabled: false },
      xAxis: {
        type: 'datetime',
        lineColor: 'rgba(255,255,255,0.1)',
        tickColor: 'rgba(255,255,255,0.1)'
      },
      yAxis: {
        gridLineColor: 'rgba(255,255,255,0.05)',
        title: { text: null }
      },
      legend: { enabled: false },
      tooltip: { valueDecimals: 2 },
      series: [
        {
          type: 'areaspline',
          name: 'PnL',
          data: points.map((point) => [point.t, point.value]),
          color: '#00ff9d', // Green for positive
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'rgba(0, 255, 157, 0.25)'],
              [1, 'rgba(0, 255, 157, 0)']
            ]
          },
          negativeColor: '#ff3b30', // Red for negative
          negativeFillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'rgba(255, 59, 48, 0.25)'],
              [1, 'rgba(255, 59, 48, 0)']
            ]
          },
          lineWidth: 2,
          marker: { radius: 0 },
          threshold: 0,
          zones: [{
            value: 0,
            color: '#ff3b30',
            fillColor: {
              linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
              stops: [
                [0, 'rgba(255, 59, 48, 0.25)'],
                [1, 'rgba(255, 59, 48, 0)']
              ]
            }
          }, {
            color: '#00ff9d',
            fillColor: {
              linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
              stops: [
                [0, 'rgba(0, 255, 157, 0.25)'],
                [1, 'rgba(0, 255, 157, 0)']
              ]
            }
          }]
        }
      ]
    } as Highcharts.Options;
  }, [points]);

  if (!points.length) {
    return <div className="h-32 rounded-lg border border-dashed border-border/50" />;
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />;
};
